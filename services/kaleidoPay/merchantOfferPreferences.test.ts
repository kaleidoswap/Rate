import AsyncStorage from '@react-native-async-storage/async-storage';
import {loadReceiverPreferences,saveReceiverPreferences,defaultReceiverPreferences,validateReceiverPreferences} from './merchantOfferPreferences';
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn()}));
const id='ab'.repeat(32);
beforeEach(()=>jest.clearAllMocks());
test('defaults to Lightning and scopes persisted order to wallet and network',async()=>{
 (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
 expect(await loadReceiverPreferences(id,'mainnet')).toEqual(defaultReceiverPreferences('mainnet'));
 const value={...defaultReceiverPreferences('mainnet'),destinations:[{type:'bark' as const,address:'ark1public',serverKey:id},{type:'lightning' as const,source:'bolt12_offer' as const}]};
 await saveReceiverPreferences(id,value);
 const [key,raw]=(AsyncStorage.setItem as jest.Mock).mock.calls[0];
 expect(key).toContain(`${id}:mainnet`);
 (AsyncStorage.getItem as jest.Mock).mockResolvedValue(raw);
 expect(await loadReceiverPreferences(id,'mainnet')).toEqual(value);
 await expect(loadReceiverPreferences(id,'signet')).rejects.toThrow('preferences');
});
test('rejects duplicate wallet types, removed fallback, credentials and invalid stored data',async()=>{
 const value=defaultReceiverPreferences('mainnet');
 expect(()=>validateReceiverPreferences({...value,destinations:[]},'mainnet')).toThrow();
 expect(()=>validateReceiverPreferences({...value,destinations:[...value.destinations,...value.destinations]},'mainnet')).toThrow();
 await expect(saveReceiverPreferences(id,{...value,destinations:[...value.destinations,{type:'bark',address:'public',serverKey:'invalid'}]})).rejects.toThrow();
 expect(AsyncStorage.setItem).not.toHaveBeenCalled();
 (AsyncStorage.getItem as jest.Mock).mockResolvedValue('broken');
 await expect(loadReceiverPreferences(id,'mainnet')).rejects.toThrow();
});
