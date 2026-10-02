import AsyncStorage from '@react-native-async-storage/async-storage';
import {encodeOffer,withAcceptedRails,decodePaymentCode} from '@universal-bolt12/universal-code';
import {saveMerchantOffer,loadMerchantOffer,merchantPaymentCode} from './merchantOfferStore';
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn()}));
const id='ab'.repeat(32), address='1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const base=encodeOffer([{type:10n,value:new TextEncoder().encode('Coffee')}]);
const rails=['btc:mainnet','ln:mainnet'];
const saved={offer:withAcceptedRails(base,rails),offer_id:id,network:'mainnet',description:'Coffee',amount:100000,rails,onchainAddress:address};
beforeEach(()=>jest.clearAllMocks());
test('one saved QR combines on-chain address, amount and original offer',async()=>{
 await saveMerchantOffer(id,saved);
 const [key,raw]=(AsyncStorage.setItem as jest.Mock).mock.calls[0];
 (AsyncStorage.getItem as jest.Mock).mockResolvedValue(raw);
 const loaded=await loadMerchantOffer(id,'mainnet');
 expect(loaded).toEqual(saved);expect(key).toContain('mainnet');
 expect(decodePaymentCode(merchantPaymentCode(loaded!),'mainnet')).toEqual({address,amountSat:100,offer:saved.offer});
});
test('rejects saved rail substitution and network-incompatible on-chain addresses',async()=>{
 await expect(saveMerchantOffer(id,{...saved,rails:[...rails].reverse()})).rejects.toThrow('do not match');
 await expect(saveMerchantOffer(id,{...saved,network:'signet'})).rejects.toThrow();
 expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
test('legacy Lightning-only offers reopen without migration or new issuance',async()=>{
 const legacy={offer:base,offer_id:id,network:'mainnet',description:'Coffee'};
 (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(legacy));
 expect(await loadMerchantOffer(id,'mainnet')).toEqual(legacy);
 expect(merchantPaymentCode(legacy)).toBe(base);
});
