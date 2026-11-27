export const PRIMARY_NAV_ORDER=Object.freeze([
  'home','culture','trace','statics','search','settings'
]);

export const PRIMARY_FEATURE_ORDER=Object.freeze(
  PRIMARY_NAV_ORDER.filter(id=>!['home','settings'].includes(id))
);
