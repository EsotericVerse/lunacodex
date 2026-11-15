'use client';
import UiText,{useUiText} from '../../i18n/UiText';
import {absoluteImageUrl} from './hero-image.mjs';

// Frame image settings: one image per text box, URL only. `onChange(changes,removeEmbedded)`.
export function HeroImageFieldset({draft,image,onChange,allowImageOnly=false}){
  const t=useUiText();
  const isHero=draft.order===1;
  return <fieldset className="scope-frame-image-settings">
    <legend>{t('uiExtra.frameEditor.imageLegend')}</legend>
    <div className="scope-frame-image-preview">
      {image?.src?<img src={image.src} alt={t('uiExtra.frameEditor.imagePreviewAlt')} loading="lazy"/>:<span>{t('uiExtra.frameEditor.imageNone')}</span>}
    </div>
    <div className="scope-frame-image-fields">
      <label className="scope-frame-image-url"><span>{t('uiExtra.frameEditor.imageUrl')}</span>
        <input type="url" value={image?.source==='default'?absoluteImageUrl(image.preset?.stable||image.src):image?.source==='custom'?(draft.image?.url||''):''}
          placeholder="https://"
          onChange={event=>{
            const url=event.target.value;
            const preset=absoluteImageUrl(image?.preset?.stable);
            onChange(url.trim()===preset?{source:'default',url:''}:{source:'custom',url},false);
          }}/>
      </label>
      {!isHero?<>
        <label><span>{t('uiExtra.frameEditor.imagePosition')}</span>
          <select value={image?.position||'right'} onChange={event=>onChange({position:event.target.value},false)} disabled={!image?.src}>
            <option value="left">{t('uiExtra.frameEditor.posLeft')}</option><option value="right">{t('uiExtra.frameEditor.posRight')}</option>
            <option value="top">{t('uiExtra.frameEditor.posTop')}</option><option value="bottom">{t('uiExtra.frameEditor.posBottom')}</option>
            {allowImageOnly?<option value="only">{t('uiExtra.frameEditor.posOnly')}</option>:null}
          </select>
        </label>
        <label><span>{t('uiExtra.frameEditor.imageWidth')}</span>
          <input type="number" min="160" max="800" step="20" value={image?.width||420}
            disabled={!image?.src} onChange={event=>onChange({width:Number(event.target.value)},false)}/>
        </label>
      </>:null}
      <button type="button" className="loc-button scope-danger-button" disabled={image?.source==='none'} onClick={()=>onChange({source:'none',url:''})}>{t('uiExtra.frameEditor.imageRemove')}</button>
    </div>
  </fieldset>;
}
