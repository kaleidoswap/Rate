import React,{createContext,useContext,useEffect} from 'react';
export const NavigationContext=createContext<any>({navigate:()=>{},goBack:()=>{},canGoBack:()=>false});
export const useNavigation=()=>useContext(NavigationContext);
export function useFocusEffect(cb:any){useEffect(cb,[cb])}
