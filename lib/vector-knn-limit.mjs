/**
 * Qdrant default maximum k for search (larger values return 400).
 * sqlite-vec Hub path uses the same cap so behavior matches across backends.
 */
export const MAX_VECTOR_KNN = 4096;
