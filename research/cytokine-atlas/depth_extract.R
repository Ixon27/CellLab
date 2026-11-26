# Counts for the independent depth experiment only. Outputs stay in the local cache.
suppressPackageStartupMessages(library(SeuratObject))
args <- commandArgs(trailingOnly=TRUE)
stopifnot(length(args)==2L)
x <- readRDS(args[1]); meta <- x[[]]; counts <- LayerData(x[['RNA']],layer='counts'); rm(x)
meta <- meta[colnames(counts), c('donor','stim','minor_label_short')]
keep <- with(meta,donor %in% 640:645 & stim %in% c('Baseline','IL2','IL4') & minor_label_short %in% c('mono','B_n','CD4_Tn','CD8_Tn','NK'))
m <- as(counts[,keep],'dgCMatrix'); rm(counts)
write.table(meta[keep,],file.path(args[2],'depth_meta.tsv'),sep='\t',row.names=FALSE,quote=FALSE)
writeLines(rownames(m),file.path(args[2],'depth_genes.txt'))
# Column-compressed CSC; avoid large and slow text MatrixMarket intermediates.
for(k in c('p','i','x')) writeBin(as.integer(slot(m,k)),file.path(args[2],paste0('depth_',k,'.i32')),size=4,endian='little')
