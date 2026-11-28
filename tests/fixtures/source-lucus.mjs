// Small test-only SiteAnchor fixture. Runtime source data is read from
// silver.loc_lucus through the typed Anchor action.
export const SOURCE_LUCUS_FIXTURE=Object.freeze([
  {uid:'UNIV0001',type:'universe',title:'Words',invisible:false,attr:{uid:['GALX0001','GALX0002']}},
  {uid:'GALX0001',type:'galaxy',title:'CMS',invisible:false,attr:{uid:['DOMN0001']}},
  {uid:'DOMN0001',type:'domain',title:'Meta',invisible:false,attr:{uid:['FROM0001','FROM0002']}},
  {uid:'FROM0001',type:'from',title:'Facebook',invisible:false,attr:{uid:[]}},
  {uid:'FROM0002',type:'from',title:'Threads',invisible:false,attr:{uid:[]}},
  {uid:'GALX0002',type:'galaxy',title:'Article',invisible:false,attr:{uid:['DOMN0002']}},
  {uid:'DOMN0002',type:'domain',title:'Post',invisible:false,attr:{uid:['FROM0003']}},
  {uid:'FROM0003',type:'from',title:'Vocus',invisible:false,attr:{uid:[]}},
  {uid:'UNIV0002',type:'universe',title:'PastBy',invisible:false,attr:{uid:['GALX0003']}},
  {uid:'GALX0003',type:'galaxy',title:'SeeYou',invisible:false,attr:{uid:['DOMN0003','DOMN0004']}},
  {uid:'DOMN0003',type:'domain',title:'Closed',invisible:false,attr:{uid:['FROM0004']}},
  {uid:'FROM0004',type:'from',title:'kkcity',invisible:false,attr:{uid:[]}},
  {uid:'DOMN0004',type:'domain',title:'NowON',invisible:false,attr:{uid:['FROM0005']}},
  {uid:'FROM0005',type:'from',title:'ptt',invisible:false,attr:{uid:[]}}
]);
