import assert from 'node:assert/strict';
import {
  RESERVED_ISR_DEFAULTS,normalizeReservedIsr,decodeRuntimeIo,encodeRuntimeIo
} from '../app/loc/query-batch-size.mjs';

const expected={enabled:false,provider:'none',revalidate_seconds:60};
assert.deepEqual(RESERVED_ISR_DEFAULTS,expected);
assert.deepEqual(normalizeReservedIsr({}),expected);
assert.deepEqual(decodeRuntimeIo(null),{io_limits:{},isr:expected});
assert.deepEqual(decodeRuntimeIo({io_limits:{archiveMiB:24}}),{
  io_limits:{archiveMiB:24},isr:expected
});

// Existing private api.manage.caches I/O settings are retained when an ISR
// placeholder is provided. The extra JSON entry never activates runtime ISR.
const saved=encodeRuntimeIo({
  io_limits:{archiveMiB:24,jsonMiB:14,documentMiB:96,timelineMiB:180},
  isr:{provider:'vercel',enabled:false,revalidate_seconds:120}
});
assert.deepEqual(saved.io_limits,{
  archiveMiB:24,jsonMiB:14,documentMiB:96,timelineMiB:180
});
assert.deepEqual(saved.isr,{
  enabled:false,provider:'vercel',revalidate_seconds:120
});
assert.deepEqual(decodeRuntimeIo(saved).isr,saved.isr);
assert.deepEqual(encodeRuntimeIo(decodeRuntimeIo(saved)),saved);

// A later edit of only the I/O section must not overwrite the reserved slot.
const ioOnlyUpdate=encodeRuntimeIo({...decodeRuntimeIo(saved),io_limits:{
  archiveMiB:40,jsonMiB:20,documentMiB:80,timelineMiB:100
}});
assert.equal(ioOnlyUpdate.isr.provider,'vercel');
assert.equal(ioOnlyUpdate.isr.enabled,false);
assert.equal(ioOnlyUpdate.io_limits.archiveMiB,40);

// No active ISR or endpoint is authorized before Vercel integration.
assert.throws(()=>normalizeReservedIsr({enabled:true}),/尚未開放啟用/);
assert.throws(()=>normalizeReservedIsr({enabled:'false'}),/尚未開放啟用/);
assert.throws(()=>normalizeReservedIsr({enabled:1}),/尚未開放啟用/);
assert.throws(()=>normalizeReservedIsr({provider:'cloudflare'}),/未支援/);
assert.throws(()=>normalizeReservedIsr({provider:'vercel',url:'https:\/\/host.example'}),/未開放/);
assert.throws(()=>normalizeReservedIsr({provider:'vercel',token:'secret'}),/未開放/);
assert.throws(()=>normalizeReservedIsr({provider:'vercel',revalidate_seconds:0}),/超出範圍/);
assert.throws(()=>normalizeReservedIsr({provider:'vercel',revalidate_seconds:3601}),/超出範圍/);
assert.throws(()=>normalizeReservedIsr({provider:'vercel',revalidate_seconds:'60'}),/超出範圍/);
assert.throws(()=>normalizeReservedIsr([]),/格式錯誤/);

// If an old/invalid persisted setting exists, reading it remains disabled.
assert.deepEqual(decodeRuntimeIo({io_limits:{jsonMiB:12},isr:{
  enabled:true,provider:'vercel'
}}),{io_limits:{jsonMiB:12},isr:expected});
assert.deepEqual(decodeRuntimeIo({io_limits:{jsonMiB:12},isr:{
  enabled:false,provider:'vercel',endpoint:'secret'
}}),{io_limits:{jsonMiB:12},isr:expected});
console.log('LOC ISR reservation: 23 disabled/portable compatibility checks PASS');
