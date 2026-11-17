// Portable, dependency-free metadata for the copied lrs:card ZModel.
// This is the logical Rune66 Class within the existing KeywordAnchor tree.
export const LRS_CARD_CLASS='runes66';
export const LRS_CARD_KEYWORD_TYPES=Object.freeze(['item','group','class']);
export const LRS_CARD_RUNE66_FIELDS=Object.freeze({
  "rune_id": "Int",
  "rune_name": "String?",
  "english_name": "String?",
  "totem": "String?",
  "group_name": "String?",
  "moon_phase": "Int?",
  "card_attr": "Int?",
  "rune_description": "String?",
  "archetype": "String?",
  "char_action": "String?",
  "positive_keywords": "String?",
  "negative_keywords": "String?",
  "extra_rules": "String?",
  "extra_notes": "String?",
  "positive_meaning": "String?",
  "half_positive_meaning": "String?",
  "half_reverse_meaning": "String?",
  "reverse_meaning": "String?",
  "rune_evolution_history": "String?",
  "myth_story": "String?",
  "soul_question": "String?",
  "practice_challenge": "String?",
  "ritual_advice": "String?",
  "harmony_advice": "String?",
  "class_enable": "Boolean?"
});
export const LRS_CARD_DRAW_READ_FIELDS=Object.freeze([
  'rune_id','rune_name','english_name','totem','group_name','moon_phase',
  'card_attr','rune_description','archetype','positive_keywords',
  'negative_keywords','extra_rules','extra_notes'
]);
export function lrsCardRune66Columns(...requested){
  const cols=requested.flat().filter(x=>x!==null&&x!==undefined);
  if(!cols.length)return Object.keys(LRS_CARD_RUNE66_FIELDS);
  const unknown=cols.filter(x=>!Object.hasOwn(LRS_CARD_RUNE66_FIELDS,x));
  if(unknown.length)throw new TypeError('Unknown lrs:card Rune66 column: '+unknown.join(','));
  return [...new Set(cols)];
}
export function lrsCardRune66ColumnString(...columns){return lrsCardRune66Columns(...columns).join(',');}
