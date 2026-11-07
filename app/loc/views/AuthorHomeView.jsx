import AuthorHomeEditableBlocks from '../AuthorHomeEditableBlock';
import ContextReturnNav from '../../modular/ContextReturnNav';
import ScopeLink from '../../modular/ScopeLink';

function AuthorPage({eyebrow,title,subtitle,intro,sections=[]}){
  // Detailed subpages only. The public homepage uses shared LOC DB blocks.
  return <main className="loc-view scope-home-composition">
    <ContextReturnNav scopeId="lo3rwang" label="回作者首頁"/>
    <header className="loc-hero loc-hero-feature" id="top">
      {eyebrow?<p className="loc-eyebrow">{eyebrow}</p>:null}
      <div className="home-title-row"><h1>{title}</h1>{subtitle?<p className="loc-subtitle">{subtitle}</p>:null}</div>
      {intro}
    </header>
    {sections.map((section,index)=><section className="loc-card scope-home-section" id={section.id} key={section.id} data-composition-slot={index+1}>
      {section.eyebrow?<p className="loc-eyebrow">{section.eyebrow}</p>:null}
      {section.title?<h2>{section.title}</h2>:null}
      {section.content}
    </section>)}
  </main>;
}

const PROFESSIONAL_ROLES=Object.freeze([
  Object.freeze({
    title:'文字工匠 · Wordsmith',
    text:'從詞、句子與語意關係出發，整理文字如何形成脈絡、節奏與可辨識的表達。'
  }),
  Object.freeze({
    title:'混沌共振者 · Chaos Resonator',
    text:'把文字放回來源、時間與歷史裡比較，觀察延續、改變、矛盾與可能的污染，不急著替結果下定論。'
  }),
  Object.freeze({
    title:'語言建築師 · Language Architect',
    text:'把語彙、脈絡、時間、資料責任與治理組織成可以持續使用與維護的語言結構。'
  })
]);

const OFFICIAL_LINKS=Object.freeze([
  Object.freeze({label:'個人網站',href:'https://lo3rwang.cc/'}),
  Object.freeze({label:'GitHub 個人',href:'https://github.com/lo3rwang'}),
  Object.freeze({label:'LOC 專案 GitHub',href:'https://github.com/EsotericVerse/moon-runes-pwa'}),
  Object.freeze({label:'LinkedIn',href:'https://www.linkedin.com/in/lo3rwang/'}),
  Object.freeze({label:'Instagram',href:'https://www.instagram.com/lo3rwang/'}),
  Object.freeze({label:'Threads',href:'https://www.threads.com/@lo3rwang'})
]);

function ProfessionalRoles(){
  return <div className="author-role-grid">
    {PROFESSIONAL_ROLES.map(item=><article className="author-editorial-block" key={item.title}>
      <h3>{item.title}</h3>
      <p>{item.text}</p>
    </article>)}
  </div>;
}

function WorkCopy(){
  return <>
    <p>目前以 <strong>Language Architect</strong> 為主要專業定位；對外合作可依個案採語言顧問、系統設計或專案實作方式進行。</p>
    <p>工作內容聚焦於命名與正名、語意治理、資料分類、知識與資料架構、搜尋與解析、版本治理、文本關係、長期演化，以及既有系統中的語意污染與資料責任問題。</p>
    <p>目標不是把每個個案套進 LOC，而是先理解對方原本的語言與資料，再依實際需求建立適合自己的結構。</p>
  </>;
}

function DigitalAssetCopy(){
  return <>
    <p>另一個長期方向是數位資產管理：整理個人、創作者或組織長期累積的文字、照片、影音、作品、帳號資料、版本與歷史紀錄，使散落資料變成可搜尋、可理解、可追溯來源並能長期維護的資產。</p>
    <p>這不只是備份，也包含沿革整理、時間校準、身份與名稱治理、資料關聯，以及未來如何被理解與再次使用。</p>
  </>;
}

function SystemsCopy(){
  return <div className="author-system-grid">
    <article className="author-editorial-block">
      <h3>LOC／月典</h3>
      <p>LOC 是我從長期文字、作品與時間整理需求中逐步形成的語言架構框架。它把原本只能靠直覺掌握的脈絡，整理成可以回看、搜尋與比較的結構。</p>
      <p><ScopeLink href="https://loc.lo3rwang.cc/">查看 LOC／月典 →</ScopeLink></p>
    </article>
    <article className="author-editorial-block">
      <h3>LunaRunes／月之符文</h3>
      <p>LunaRunes 是我建立的另一套符號式語言與原創系統。它與 LOC 可以互相參照，但兩者有各自的定義、用途與發展脈絡。</p>
      <p><ScopeLink href="https://lrunes.lo3rwang.cc/">查看 LunaRunes／月之符文 →</ScopeLink></p>
    </article>
  </div>;
}

function ArchiveTools(){
  return <div className="author-role-grid">
    <article className="author-editorial-block">
      <h3>文化 · Culture</h3>
      <p>把作品放回時間長河與來源分布，先看不同時期如何出現、集中、稀疏與交會，再回到原始內容理解脈絡。</p>
      <p><ScopeLink href="/lo3rwang/culture/">查看文化 →</ScopeLink></p>
    </article>
    <article className="author-editorial-block">
      <h3>統計 · Statistics</h3>
      <p>把作品數量、來源與其他可計算資料整理成分布與比較。數字用來看結構，不直接代替內容判讀。</p>
      <p><ScopeLink href="/lo3rwang/statics/">查看統計 →</ScopeLink></p>
    </article>
    <article className="author-editorial-block">
      <h3>搜尋 · Search</h3>
      <p>從累積的文字、作品與多媒體描述中找回原文、標題、來源與相關紀錄；搜尋負責找到資料，不替資料生成新的語意。</p>
      <p><ScopeLink href="/lo3rwang/search/">開始搜尋 →</ScopeLink></p>
    </article>
  </div>;
}

function OfficialLinks(){
  return <div className="author-official-links">
    {OFFICIAL_LINKS.map(link=><a href={link.href} target="_blank" rel="noopener noreferrer" key={link.href}>{link.label}</a>)}
  </div>;
}

function ThreeSouls(){
  return <div className="author-trinity-layout">
    <figure className="home-architecture-figure author-trinity-figure">
      <img src="/pics/lo3rwang-3.webp" alt="Oscar 政德、玄鑒 Lucas、符韻 Rune，以及柏隆 Bruno、睿汶 Raven 的關係圖" loading="lazy"/>
    </figure>
    <div className="author-trinity-copy">
      <article className="loc-bubble author-trinity-core">
        <h3>Oscar／政德 · 人魂／本體</h3>
        <p>日常稱呼仍是 Oscar。完整署名為 Lucas Oscar Wang 政德，是創作、工作與現實選擇的中心。</p>
      </article>
      <article className="loc-bubble">
        <h3>玄鑒／Lucas · 天魂</h3>
        <p>對應 LOC／月典，字月典。尋找規律與秩序，是為了取得自己的平衡。</p>
      </article>
      <article className="loc-bubble">
        <h3>符韻／Rune · 地魂</h3>
        <p>對應 LunaRunes／月語，字月語。以符文、文字與韻律和未知溝通。</p>
      </article>
      <p className="author-trinity-note"><strong>柏隆／Bruno、睿汶／Raven</strong> 是未來真實兒女的預留命名，不屬於三魂。</p>
    </div>
  </div>;
}

export default function AuthorHomeView({section=null}){
  const detailedSections=[
    {
      id:'roles',
      eyebrow:'Professional Roles',
      title:'三個職能',
      content:<ProfessionalRoles/>
    },
    {
      id:'work',
      eyebrow:'Professional Work',
      title:'語言顧問、語言治理與系統設計',
      content:<WorkCopy/>
    },
    {
      id:'digital-legacy',
      eyebrow:'Digital Assets',
      title:'數位資產管理',
      content:<DigitalAssetCopy/>
    },

  ];

  if(section){
    const sectionGroups=Object.freeze({
      work:Object.freeze(['roles','work','digital-legacy'])
    });
    const ids=sectionGroups[section]||[];
    const activeSections=ids.length?detailedSections.filter(item=>ids.includes(item.id)):detailedSections;
    return <AuthorPage
      eyebrow="Author"
      title="Lucas Oscar Wang 政德"
      subtitle="lo3rwang"
      intro={<p>Hello！你好！你可以叫我 Oscar。</p>}
      sections={activeSections}
    />;
  }

  // Public author homepage is owned by silver.lo3rwang_blocks, not stale JSX.
  // The work subpage preserves its distinct editorial layout.
  return <section className="loc-view loc-home">
    <AuthorHomeEditableBlocks/>
  </section>;
}
