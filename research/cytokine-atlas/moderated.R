# Six donor-level differences, no cell-level pseudo-replicates or voom weights.
suppressPackageStartupMessages(library(limma))
a <- commandArgs(trailingOnly=TRUE); n <- as.integer(a[2]); p <- as.integer(a[3]); blocks <- as.integer(a[4]); x <- file(a[1],'rb'); y <- file(a[5],'wb')
for (b in seq_len(blocks)) {
  m <- matrix(readBin(x,'double',n*p,size=8,endian='little'),nrow=p,ncol=n)
  fit <- eBayes(lmFit(m,matrix(1,n,1)));writeBin(as.double(fit$t[,1]),y,size=8,endian='little')
}
close(x);close(y)
