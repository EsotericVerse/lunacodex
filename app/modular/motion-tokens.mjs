// Shared timing contract for React Motion and CSS-driven LOC transitions.
// Values are seconds, matching the --loc-motion-* CSS tokens.
export const LOC_MOTION=Object.freeze({
  fast:.16,
  feedback:.18,
  standard:.28,
  emphasis:.52,
  arrival:.9,
  ease:Object.freeze([.22,1,.36,1]),
  easeSoft:Object.freeze([.16,1,.3,1])
});
