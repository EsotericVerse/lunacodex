'use client';

import {createContext,useCallback,useContext,useMemo,useReducer} from 'react';
import {
  createFeatureFocusState,
  featureFocusForScope,
  featureFocusReducer
} from './feature-focus-state.mjs';

const FeatureFocusContext=createContext(null);
const noop=()=>{};

export function FeatureFocusProvider({scopeId,children}){
  const [state,dispatch]=useReducer(featureFocusReducer,scopeId,createFeatureFocusState);
  const selectFocus=useCallback(selection=>dispatch({type:'select',scopeId,...selection}),[scopeId]);
  const setFocusRange=useCallback(range=>dispatch({type:'set-range',scopeId,...range}),[scopeId]);
  const clearFocus=useCallback(()=>dispatch({type:'clear',scopeId}),[scopeId]);
  const value=useMemo(()=>({state,selectFocus,setFocusRange,clearFocus,scopeId}),
    [state,selectFocus,setFocusRange,clearFocus,scopeId]);
  return <FeatureFocusContext.Provider value={value}>{children}</FeatureFocusContext.Provider>;
}

export function useFeatureFocus(scopeId=''){
  const context=useContext(FeatureFocusContext);
  if(!context)return {focus:null,dateRange:null,selectFocus:noop,setFocusRange:noop,clearFocus:noop};
  const scoped=featureFocusForScope(context.state,scopeId||context.scopeId);
  return {
    focus:scoped?.focus||null,
    dateRange:scoped?.dateRange||null,
    selectFocus:context.selectFocus,
    setFocusRange:context.setFocusRange,
    clearFocus:context.clearFocus
  };
}
