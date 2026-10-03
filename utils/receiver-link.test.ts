import {isReceiverLink,canOpenReceiver} from './receiver-link';
test('only the exact receiver navigation link is accepted',()=>{
 expect(isReceiverLink('com.kaleidoswap.wallet://receive/reusable')).toBe(true);
 for(const value of ['https://receive/reusable','com.kaleidoswap.wallet://receive/reusable?secret=x','com.kaleidoswap.wallet://pay','com.kaleidoswap.wallet://receive/reusable/'])expect(isReceiverLink(value)).toBe(false);
});
test('receiver links wait for initialization and unlock without bypassing onboarding',()=>{
 expect(canOpenReceiver(true,true,'Dashboard')).toBe(true);
 expect(canOpenReceiver(true,true,'DashboardTab')).toBe(true);
 for(const args of [[false,true,'Dashboard'],[true,false,'Dashboard'],[true,true,'InitialLoad'],[true,true,'WalletSetup'],[true,true,undefined]] as const)expect(canOpenReceiver(...args)).toBe(false);
});
