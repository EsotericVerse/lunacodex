'use client';

import {useAsyncResource} from '../../zenstack/client-queries';
import {useUiText} from '../i18n/UiText';
import {readScopeSearchSummary,summaryScopeIds} from './scope-search-summary.mjs';

export default function SearchSummary({scopeIds=[]}){
  const t=useUiText();
  const ids=summaryScopeIds(scopeIds);
  const key=ids.join('|');
  const query=useAsyncResource({
    queryKey:['scope-search-summary',key],
    queryFn:()=>readScopeSearchSummary(ids),
    enabled:ids.length>0,
    revalidateOnFocus:false,
    revalidateOnReconnect:false
  });
  const summary=query.data?.summary;
  const numbers=new Intl.NumberFormat();
  const summaryText=summary
    ?summary.articleCount===0
      ?t('uiExtra.searchUI.summaryEmpty')
      :t('uiExtra.searchUI.summaryText',{
        articles:numbers.format(summary.articleCount),
        chars:numbers.format(summary.wordCount),
        first:summary.firstDate||'—',
        last:summary.lastDate||'—'
      })
    :!ids.length||query.isPending
      ?t('uiExtra.searchUI.summaryLoading')
      :query.isError
        ?t('uiExtra.searchUI.summaryFailed')
        :t('uiExtra.searchUI.summaryMissing');
  return <div className="scope-search-total-bubble" role="status">
    <p className="scope-search-total-copy">{summaryText}</p>
  </div>;
}
