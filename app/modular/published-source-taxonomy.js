// Public snapshot of silver.loc.ArticleTag; Scope source taxonomy is not configurable.
import {sourceTaxonomyFromArrays} from '../loc/source-classification.mjs';
export const PUBLISHED_LOC_ARTICLE_TAGS=Object.freeze(['Facebook','Threads','Instagram','Others']);
export const PUBLISHED_SOURCE_LISTS=Object.freeze({loc:{system:PUBLISHED_LOC_ARTICLE_TAGS,personal:[]}});
export const PUBLISHED_SOURCE_ENTRIES=Object.freeze({});
export const PUBLISHED_SOURCE_DOMAINS=Object.freeze({});
const taxonomy=Object.freeze(sourceTaxonomyFromArrays(PUBLISHED_LOC_ARTICLE_TAGS));
export const publishedSourceTaxonomy=()=>taxonomy;
export const publishedSourceCategoryCatalog=()=>({categories:taxonomy.categories,aliases:taxonomy.aliases});
