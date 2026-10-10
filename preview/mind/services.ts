export const PairingService={getActive:async()=>null,forget:async()=>{}};
export const formatDistance=(m:number)=>m<1000?`${m} m`:`${(m/1000).toFixed(1)} km`;
const toast={success:()=>{},error:(s:string)=>window.alert(s),info:()=>{}};
export default class ToastService{static getInstance(){return toast}}
