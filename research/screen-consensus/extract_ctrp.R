# Only base R is needed to extract the archived ORCESTRA data slots.
args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) == 2)
p <- readRDS(args[1])
s <- attr(p, 'sensitivity'); cells <- attr(p, 'cell'); drugs <- attr(p, 'drug')
stopifnot(identical(rownames(s$info), rownames(s$profiles)),
          !anyDuplicated(cells$cellid), !anyDuplicated(drugs$drugid))
x <- s$info[, c('cellid', 'drugid')]
x$ccl_name <- cells$ccl_name[match(x$cellid, cells$cellid)]
x$broad_id <- drugs$broad_cpd_id[match(x$drugid, drugs$drugid)]
# Area ABOVE the viability curve (not the published differently scaled summary).
# Larger AAC means greater sensitivity. Negate to obtain lower-is-more-sensitive ranks.
x$ctrp <- -s$profiles$aac_recomputed
write.csv(x[is.finite(x$ctrp), ], args[2], row.names = FALSE, na = '')
