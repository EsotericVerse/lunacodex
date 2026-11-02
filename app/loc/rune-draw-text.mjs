// Convert saved rune draw structures into the readable card sequence.
export function runeDrawText(value){
  if(value===undefined||value===null)return '';
  let parsed=value;
  if(typeof parsed==='string'){
    const raw=parsed.trim();
    if(!raw)return '';
    if(!raw.startsWith('{')&&!raw.startsWith('['))return raw;
    try{parsed=JSON.parse(raw)}catch{return '';}
  }
  const cards=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.cards)?parsed.cards:null);
  if(!cards)return '';
  return cards.map(card=>{
    if(!card||typeof card!=='object')return '';
    const name=String(card.rune??card.name??'').trim();
    const direction=String(card.direction??card.orientation??'').trim();
    return name&&direction?name+' '+direction:'';
  }).filter(Boolean).join('，');
}
