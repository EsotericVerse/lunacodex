'use client';
import {useUiLocale} from '../i18n/ui-locale';
import {translateUiField} from '../i18n/ui-copy';

import {navigationHref} from './routing/scope-registry.js';
import useNativeNavigation from './use-native-navigation';
import ScopeLink from './ScopeLink';

// A page-local parent link; no new fixed or floating navigation bar.
export default function ContextReturnNav({scopeId='lrunes',path='',label='返回功能首頁'}){
  const {locale}=useUiLocale();
  const native=useNativeNavigation();
  return <nav className="scope-context-return scope-preview-links" aria-label={translateUiField(locale,'返回上層')}>
    <ScopeLink className="loc-button" href={navigationHref(scopeId,path,native)} native={native}>← {label}</ScopeLink>
  </nav>;
}
