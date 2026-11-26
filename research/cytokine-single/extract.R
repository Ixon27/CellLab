# Extract published annotations and raw RNA counts; keep single-cell data outside the repo.
suppressPackageStartupMessages(library(SeuratObject))
args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) == 2L)
object <- readRDS(args[[1L]])
meta <- object[[]]
rna <- object[["RNA"]]
rm(object)

stopifnot(identical(Layers(rna, search = "^counts$"), "counts"))
counts <- LayerData(rna, layer = "counts")
rm(rna)
stopifnot(inherits(counts, "sparseMatrix"), setequal(rownames(meta), colnames(counts)))
meta <- meta[colnames(counts), c("donor", "stim", "minor_label_short")]
stopifnot(!anyNA(meta))

# A single representative of each broad lineage, determined by published taxonomy.
keep <- meta$donor %in% 640:645 & meta$stim %in% c("Baseline", "IL2", "IL4") &
  meta$minor_label_short %in% c("mono", "B_n", "CD4_Tn", "CD8_Tn", "NK")
meta <- meta[keep, ]
key <- with(meta, paste(donor, stim, minor_label_short, sep = ":"))
groups <- unique(meta)
groups$key <- with(groups, paste(donor, stim, minor_label_short, sep = ":"))
assignment <- match(key, groups$key)
groups$cells <- tabulate(assignment, nrow(groups))
indicator <- Matrix::sparseMatrix(i = which(keep), j = assignment, x = 1,
                                 dims = c(ncol(counts), nrow(groups)))
pseudobulk <- as.matrix(counts %*% indicator)
stopifnot(all(pseudobulk >= 0), all(pseudobulk == floor(pseudobulk)))
groups$umis <- colSums(pseudobulk)
colnames(pseudobulk) <- groups$key

write.table(groups, file.path(args[[2L]], "groups.tsv"), row.names = FALSE, sep = "\t", quote = FALSE)
write.table(pseudobulk, file.path(args[[2L]], "counts.tsv"), col.names = NA, sep = "\t", quote = FALSE)
