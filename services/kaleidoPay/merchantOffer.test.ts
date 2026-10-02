import {createMerchantOffer,listMerchantReceipts} from './merchantOffer';
import {encodeOffer} from '@universal-bolt12/universal-code';
const id='ab'.repeat(32),hash='cd'.repeat(32);
test('requires explicit offer capabilities and the same network before creating',async()=>{
 const request=jest.fn().mockResolvedValue({network:'signet',methods:[]});
 await expect(createMerchantOffer({request},'mainnet','Coffee',100)).rejects.toThrow('does not support');
 expect(request).toHaveBeenCalledTimes(1);
 request.mockResolvedValueOnce({network:'mainnet',methods:['kaleidopay_make_offer','kaleidopay_list_offer_payments']}).mockResolvedValueOnce({offer:encodeOffer([{type:10n,value:new TextEncoder().encode('Coffee')}]),offer_id:id,amount:100000});
 await expect(createMerchantOffer({request},'mainnet','Coffee',100)).resolves.toMatchObject({offer_id:id});
 expect(request).toHaveBeenLastCalledWith('kaleidopay_make_offer',{description:'Coffee',amount:100000});
});
test('reads all pages and deduplicates hashes',async()=>{
 const receipt={payment_hash:hash,amount:100000,state:'settled'};
 const request=jest.fn().mockResolvedValueOnce({offer_id:id,payments:[receipt],next_page_token:'p:1'}).mockResolvedValueOnce({offer_id:id,payments:[receipt],next_page_token:null});
 expect(await listMerchantReceipts({request},id)).toHaveLength(1);
 expect(request).toHaveBeenLastCalledWith('kaleidopay_list_offer_payments',{offer_id:id,page_token:'p:1'});
});
test('rejects repeated pages instead of reporting a partial total',async()=>{
 const request=jest.fn().mockResolvedValue({offer_id:id,payments:[],next_page_token:'p:1'});
 await expect(listMerchantReceipts({request},id)).rejects.toThrow('pagination');
});
