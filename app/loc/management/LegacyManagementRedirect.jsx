'use client';
import {useEffect} from 'react';

// Static-export-friendly aliases for bookmarks created by the old menu.
// Keep non-section context parameters such as scopeid and lucusDate intact.
export default function LegacyManagementRedirect({target='trace',label='空間定錨管理'}){
  const isGroup=target==='group';
  const fallback=isGroup?'/manage/':'/trace/manage/';
  useEffect(()=>{
    const url=new URL(window.location.href);
    const matcher=isGroup
      ?/\/culture\/manage(?:\/index\.html|\/)?$/
      :/\/manage(?:\/index\.html|\/)?$/;
    const nativeFile=/\/index\.html$/.test(url.pathname);
    const destination=isGroup?'manage':'trace/manage';
    const next=url.pathname.replace(matcher,
      '/'+destination+(nativeFile?'/index.html':'/'));
    if(next===url.pathname&&!url.searchParams.has('section'))return;
    url.pathname=next;
    url.searchParams.delete('section');
    // Replace keeps Back from re-entering the old editing URL.
    window.location.replace(url.href);
  },[isGroup]);
  return <main className="scope-main"><section className="scope-page">
    <p className="scope-status" role="status">管理入口已調整，正在前往{label}…</p>
    <a href={fallback}>前往{label}</a>
  </section></main>;
}
