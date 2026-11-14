'use client';

import {useAsyncResource} from '../../zenstack/client-queries';
import {selectRows} from '../loc/db-query.mjs';
import {runeImage} from './rune-directory.mjs';
import RuneCardInfo from './RuneCardInfo';
import RuneCardEntryBubbles from './RuneCardEntryBubbles';
import {lRunes66ColumnString} from '../../zenstack/lrunes-read-model.mjs';

export default function RuneIntroSection(){
  const sample=useAsyncResource(['lunarunes-intro-rune',66],async()=>{
      const {rows}=await selectRows('silver.runes',{
        columns:lRunes66ColumnString('rune_id','rune_name','english_name','totem','group_name','moon_phase','card_attr','rune_description','archetype','positive_keywords','negative_keywords'),
        filters:[{column:'rune_id',operator:'eq',value:66}],
        limit:1,offset:0
      });
      return rows?.[0]||null;
  });
  return <section className="loc-card home-copy-block home-rune-section runes-home-intro">
    <div className="home-section-heading runes-home-intro-heading">
      <p className="loc-eyebrow">LunaRunes(Symbolic Language)</p>
      <h2>月之符文籤詩系統</h2>
      <p className="loc-subtitle">不涉及神秘學，為單純的指引籤詩<br/>不保證一定就是註定，你擁有選擇權。</p>
    </div>
    <div className="home-rune-layout runes-home-intro-layout">
      {sample.data?<RuneCardInfo card={sample.data} imageSrc={runeImage(sample.data)} layout="home" direction="正位"/>:
        <div className="home-rune-preview runes-home-intro-preview" aria-busy={sample.isPending}>
          <p className="scope-status">{sample.error?'符文示例目前無法讀取。':'正在讀取符文示例…'}</p>
        </div>}
      <div className="home-rune-copy home-rune-copy-plain runes-home-intro-copy">
        <p className="runes-hint-kicker">不知道怎麼說的話，往下抽牌就對了！</p>
        <p>沒什麼想問的，抽個每日符文看看吧！</p>
        <p className="runes-hint-lead">月之符文的特有66符文字會給你提示籤詩，指引你的可能未來；能是祝福可能是警告，你當然擁有選擇權。</p>
        <p className="runes-hint-seed">抽牌讓這符文成語意種子，成為語意起點，<br/>用你想要的方式，成長成為完整語意的成熟果實。</p>
        <p>最後的選擇權仍然在你的手上！</p>
        <RuneCardEntryBubbles />
      </div>
    </div>
  </section>;
}
