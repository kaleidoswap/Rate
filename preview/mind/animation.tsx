import {useRef} from 'react';
import {Animated,Easing} from 'react-native-web';
export {Easing}; export default Animated;
export const useSharedValue=(v:any)=>useRef({value:v}).current;
export const useAnimatedStyle=(fn:any)=>fn();
export const withTiming=(v:any)=>v,withDelay=(_d:number,v:any)=>v,withSequence=(...v:any[])=>v[v.length-1],withSpring=(v:any)=>v,withRepeat=(v:any)=>v,cancelAnimation=()=>{},runOnJS=(fn:any)=>fn,useReducedMotion=()=>false;
export const interpolate=(v:number,input:number[],output:number[])=>output[0]+v*(output[1]-output[0]);
