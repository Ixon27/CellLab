# Input: little-endian int32 blocks [lineage, arm, donor, feature].
# Output: little-endian float64 per panel, in the order read by run.py.
suppressPackageStartupMessages({library(edgeR); library(limma)})
args <- commandArgs(trailingOnly=TRUE)
stopifnot(length(args) == 5L)
p <- as.integer(args[2]); donors <- as.integer(args[3]); types <- as.integer(args[4]); prefix <- args[5]
input <- file(args[1], "rb")
counts <- lapply(seq_len(types), function(i) {
    matrix(readBin(input, "integer", p * 2L * donors, size=4L, endian="little"), nrow=p)
})
close(input)
donor <- factor(rep(seq_len(donors), 2L))
arm <- rep(c("baseline", "treated"), each=donors)
arm <- factor(arm, levels=c("baseline", "treated"))
design <- model.matrix(~ donor + arm)
stopifnot(qr(design)$rank == ncol(design))
libs <- lapply(counts, colSums)
stopifnot(all(unlist(libs) > 0))
expressed <- Map(function(x, lib) filterByExpr(x, group=arm, lib.size=lib), counts, libs)
abundant <- Map(function(x, lib) rowSums(sweep(x, 2L, lib / 1e6, `/`) >= 1), counts, libs)
filters <- list(shared_cpm=Reduce(`+`, abundant) >= donors,
                shared_filter_by_expr=Reduce(`&`, expressed))
for (panel in names(filters)) {
    keep <- filters[[panel]]
    stopifnot(sum(keep) >= 100L)
    out <- file(paste0(prefix, "-", panel, ".bin"), "wb")
    write_score <- function(x) {
        stopifnot(length(x) == sum(keep), all(is.finite(x)))
        writeBin(as.double(x), out, size=8L, endian="little")
    }
    allzero <- function(x) rowSums(x) == 0
    for (i in seq_len(types)) {
        x <- counts[[i]][keep, , drop=FALSE]
        nonzero <- !allzero(x)
        # A gene with no counts in this lineage retains its shortlist slot,
        # but doesn't contribute to that lineage's dispersion fit.
        y <- DGEList(x[nonzero, , drop=FALSE], lib.size=libs[[i]], group=arm)
        y <- normLibSizes(y, method="TMM")
        fit <- glmQLFit(y, design, robust=TRUE, legacy=FALSE)
        test <- glmQLFTest(fit, coef="armtreated")$table
        min_f <- min(test$F)
        if (!is.finite(min_f) || min_f < -1e-5) {
            stop(sprintf("%s lineage %d: invalid minimum QL F: %.8g", panel, i, min_f))
        }
        # Subtracting two fitted deviances can leave a tiny negative at zero.
        if (min_f < 0) {
            message(sprintf("%s lineage %d: %d QL F values rounded to zero (min %.3g)",
                            panel, i, sum(test$F < 0), min_f))
        }
        score <- numeric(nrow(x))
        score[nonzero] <- sign(test$logFC) * sqrt(pmax(test$F, 0))
        write_score(score)
    }
    delta <- Map(function(x, lib) {
        logcpm <- log2(sweep(x[keep, , drop=FALSE] + 0.5, 2L, (lib + 1) / 1e6, `/`))
        logcpm[, arm == "treated", drop=FALSE] - logcpm[, arm == "baseline", drop=FALSE]
    }, counts, libs)
    limma_score <- function(m) eBayes(lmFit(m, matrix(1, donors, 1L)))$t[, 1L]
    for (x in delta) write_score(limma_score(x))
    for (i in seq_len(types)) write_score(limma_score(Reduce(`+`, delta[-i]) / (types - 1L)))
    for (i in seq_len(types)) {
        other <- Reduce(`+`, delta[-i]) / (types - 1L)
        write_score(limma_score((delta[[i]] + other) / 2))
    }
    close(out)
    writeBin(which(keep), paste0(prefix, "-", panel, "-indices.bin"), size=4L, endian="little")
}
versions <- vapply(c("edgeR", "limma", "locfit", "statmod"), function(x) as.character(packageVersion(x)), "")
writeLines(c(R.version.string, paste(names(versions), versions)), paste0(prefix, "-versions.txt"))
