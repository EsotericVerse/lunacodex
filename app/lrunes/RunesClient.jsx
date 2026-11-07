import {navigationHref} from '../modular/scope-registry.js';
import useNativeNavigation from '../modular/use-native-navigation';
import {usePassiveSessionAccount} from '../loc/use-account';
import ScopeLink from '../modular/ScopeLink';
import RuneIntroSection from './RuneIntroSection';
import {HomeBlock} from '../loc/home-block-model';
import {resolveHomeImage,RunesHomeBlockDisplay,locHomeBlockClass,homeBlockMediaStyle} from '../loc/LocHomeBlockDisplay';
import ScopeEditableBlocks from '../loc/ScopeEditableBlocks';

const runeHref=(path,native)=>navigationHref('lrunes',path,native);

// LunaRunes is a special-case homepage: only the Hero copy is editable.
// Draw routes, draw buttons, game, intro, and reading guidance remain fixed UI.
function renderRuneHero(slot,native){
  const sign=HomeBlock.heroExtraFor('lrunes');
  const eyebrow=slot.stored?slot.eyebrow:'';
  const title=slot.stored?slot.title:'';
  const subtitle=slot.stored?slot.subtitle:'';
  const text=slot.stored?slot.text:'';
  const image=resolveHomeImage({...slot,order:1},'lrunes');
  const children=slot.stored?HomeBlock.visibleEntities(slot).filter(entity=>entity.title||String(entity.text||'').replace(/<[^>]*>/g,'').trim()):[];
  return <>
    {image.src?<picture>
            <img
        className="runes-home-hero-image"
        src={image.src}
        alt=""
        aria-hidden="true"
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
    </picture>:null}
    <div className="runes-home-hero-overlay" aria-hidden="true"/>
    {sign?<span className={'home-hero-identity home-hero-identity--'+sign.key}
      role="img" aria-label={sign.label}>{sign.text}</span>:null}
    <div className="runes-home-hero-copy">
      {eyebrow?<p className="loc-eyebrow">{eyebrow}</p>:null}
      <div className="home-title-row">
        <h1>{title}</h1>
        {subtitle?<div className="loc-subtitle" dangerouslySetInnerHTML={{__html:subtitle}}/>:null}
      </div>
      {text?<div className="runes-home-body scope-rich-surface" dangerouslySetInnerHTML={{__html:text}}/>:null}
      {children.length?<div className="loc-home-block__children runes-home-children" style={{'--loc-bubble-columns':HomeBlock.bubbleColumns([slot.bubbleColumns],'hero')}}>
        {children.map((entity,index)=>{
          const card=HomeBlock.childPresentation(entity.title)==='card';
          return <article className={'loc-home-block__child '+(card?'loc-home-block__child--card':'loc-home-block__child--bubble')} key={entity.uid||'child-'+index}>
            {card?<h3>{entity.title}</h3>:null}
            <div className="loc-home-block__child-copy scope-rich-surface" dangerouslySetInnerHTML={{__html:entity.text}}/>
          </article>;
        })}
      </div>:null}
    </div>
  </>;
}

export default function RunesClient(){
  const native=useNativeNavigation();
  // Only a signed-in state is needed for the daily log navigation.
  const account=usePassiveSessionAccount();
  return <main className="loc-next-main"><section className="loc-view">
    <ScopeEditableBlocks
      scopeId="lrunes"
      page="hero"
      allowEditing
      maxBlocks={8}
      headingLevel={2}
      slotClassName="loc-card loc-home-block"
      resolveSlotClassName={slot=>Number(slot.order)===1
        ?"loc-hero runes-home-hero"
        :locHomeBlockClass(slot,'lrunes')}
      resolveSlotStyle={slot=>homeBlockMediaStyle(slot,'lrunes')}
      editSlotClassName="loc-card loc-home-block"
      containerless
      placeholderFirstOrder={1}
      renderDisplay={slot=>Number(slot.order)===1?renderRuneHero(slot,native):RunesHomeBlockDisplay(slot)}
      explicitEditButton
      toggleExtra={account.user?<nav className="runes-home-nav runes-home-secondary-nav" aria-label="月之符文延伸功能">
        <ScopeLink className="loc-button" href={runeHref('daily/log',native)} native={native}>每日符文紀錄</ScopeLink>
      </nav>:null}
    />

    <RuneIntroSection />

    <section className="loc-card rune-basics runes-reading-flow">
      <h2>基本判讀順序</h2>
      <div className="basic-grid">
        <article className="basic-item"><h3>1. 先看符文本義</h3><p>先確認每張符文最基本的語意，作為整體判讀的核心。</p></article>
        <article className="basic-item"><h3>2. 再看卡牌方向</h3><p>正位、半正位、半逆位、逆位描述同一符文在當下狀態中的不同表現。</p></article>
        <article className="basic-item"><h3>3. 看月相交互</h3><p>以當日真實月相與該符文本身的卡牌月相交互，取得當下情境中的對應狀況。</p></article>
        <article className="basic-item"><h3>4. 多張再看模組</h3><p>若為多張抽牌，再依雙卡、三卡、五卡、指定張數或 OW3gs 各自的模組結構進行組合判讀。</p></article>
      </div>
    </section>

    <section className="loc-card rune-basics runes-custom-draw-section">
      <h2>符文抽牌</h2>
      <p>同一個抽牌入口可切換 2D 平面原創卡面與最新 3D 特效，並自由決定抽取 1 至 11 枚。</p>
      <ScopeLink className="loc-button" href={runeHref('card/duel',native)} native={native}>開始抽牌</ScopeLink>
    </section>

    <section className="loc-card rune-basics runes-review-section">
      <div className="home-section-heading">
        <p className="loc-eyebrow">Reading & Review</p>
        <h2>判讀與回測結果</h2>
      </div>
      <div className="runes-review-grid" aria-label="判讀與回測結果說明">
        <article className="runes-review-item">
          <strong>天時一直在改變</strong>
          <p>月之符文由於有天時設定（當前月相與卡片月相的交互作用），所以每次的判讀跟回測結果都可能會有差異。這是因為外在的時機一直在改變，符文的解析方式必須跟隨時機而動，才不會有跟不上時代的結果狀況。</p>
        </article>
        <article className="runes-review-item">
          <strong>符文推演的是可能性</strong>
          <p>而符文只是推演出未來的可能性，將一片完全未知的未來，設定好一個風格濾鏡，方便你作不同解度的切入解析。</p>
        </article>
        <article className="runes-review-item">
          <strong>命運仍然在你手上</strong>
          <p>命運的掌控始終在你手上。符文並不會替你做下決定，也不會武斷認為一定可以或一定不可以。只是提供一個解析方向，方便你在完全沒有頭緒的迷霧中，慢慢找到適合自己的方式去處理跟面對。</p>
        </article>
        <article className="runes-review-item">
          <strong>回測不是把結果刷到滿意</strong>
          <p>當然可以一直回測，如果你只是想要回測直到結果滿意，當然可以，但真正的命運並不會讓你滿意。命運即是如此。</p>
        </article>
        <article className="runes-review-item">
          <strong>符文不替你叫醒自己</strong>
          <p>如果你選擇裝睡不肯醒來，符文也沒有義務要提醒你鬧鐘設定，也不會武斷的叫你放棄或選擇繼續，只是提供一個解析的方式來做參考。</p>
        </article>
        <article className="runes-review-item">
          <strong>符文不是神秘學權威</strong>
          <p>月之符文不是神秘學權威，也不要求你把抽牌結果當成不可質疑的真理。它是一套以符文本義、卡牌方向與月相交互提供解析角度的指引籤詩；你可以把結果當作參考、提示，或重新整理問題的起點。接受或不接受、採取什麼行動，仍然是你的選擇。</p>
        </article>
      </div>
    </section>
  </section></main>;
}
