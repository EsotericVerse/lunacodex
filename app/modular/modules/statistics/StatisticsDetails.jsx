'use client';
import {useState} from 'react';
import UiText from '../../../i18n/UiText';
import {useUiSection} from '../../../i18n/ui-locale';

export default function StatisticsDetails({children,summary=null,className='scope-stat-details',onOpen=null}){
  useUiSection('uiExtra.statisticsView');
  const [open,setOpen]=useState(false);
  return <details className={className} onToggle={event=>{const next=event.currentTarget.open;setOpen(next);if(next)onOpen?.();}}>
    <summary>{summary??<UiText id="uiExtra.statisticsView.viewDetails"/>}</summary>
    {open?(typeof children==='function'?children():children):null}
  </details>;
}
