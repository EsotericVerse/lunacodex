'use client';

import {createContext,useCallback,useContext,useMemo,useReducer} from 'react';
import {
  createFeatureFocusState,
  featureFocusForScope,
  featureFocusStatesReducer
} from './feature-focus-state.mjs';

const FeatureFocusContext=createContext(null);
const noop=()=>{};
const scopeKey=value=>{
  const id=String(value||'').trim().toLowerCase();
  return /^[a-z][a-z0-9]{0,14}$/.test(id)?id:'';
};

export function FeatureFocusProvider({scopeId,children}){
  const currentScope=scopeKey(scopeId);
  const [states,dispatch]=useReducer(featureFocusStatesReducer,currentScope,
    id=>({[id]:createFeatureFocusState(id)}));
  const selectFocus=useCallback(selection=>dispatch({type:'select',scopeId,...selection}),[scopeId]);
  const setFocusRange=useCallback(range=>dispatch({type:'set-range',scopeId,...range}),[scopeId]);
  const clearFocusRange=useCallback(()=>dispatch({type:'clear-range',scopeId}),[scopeId]);
  const clearFocus=useCallback(()=>dispatch({type:'clear',scopeId}),[scopeId]);
  const carryFocus=useCallback((toScopeId,feature)=>dispatch({type:'carry',
    fromScopeId:scopeId,toScopeId,feature}),[scopeId]);
  const value=useMemo(()=>({states,selectFocus,setFocusRange,clearFocusRange,clearFocus,carryFocus,scopeId}),
    [states,selectFocus,setFocusRange,clearFocusRange,clearFocus,carryFocus,scopeId]);
  return <FeatureFocusContext.Provider value={value}>{children}</FeatureFocusContext.Provider>;
}

export function useFeatureFocus(scopeId=''){
  const context=useContext(FeatureFocusContext);
  if(!context)return {focus:null,article:null,dateRange:null,selectFocus:noop,setFocusRange:noop,
    clearFocusRange:noop,carryFocus:noop,clearFocus:noop};
  const target=scopeKey(scopeId||context.scopeId);
  const scoped=featureFocusForScope(context.states?.[target],target);
  return {
    focus:scoped?.focus||null,
    article:scoped?.article||null,
    dateRange:scoped?.dateRange||null,
    selectFocus:context.selectFocus,
    setFocusRange:context.setFocusRange,
    clearFocusRange:context.clearFocusRange,
    carryFocus:context.carryFocus,
    clearFocus:context.clearFocus
  };
}
