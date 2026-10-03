import {receiverDestinationFromWallet} from './merchantOfferWallet';
const key='ab'.repeat(32);
test('imports SDK address and normalizes the compressed server key',async()=>{
 const adapter={getConnectionInfo:jest.fn().mockResolvedValue({connected:true,network:'bitcoin',nodeId:'02'+key}),getReceiveAddress:jest.fn().mockResolvedValue({address:'ark1public'})};
 expect(await receiverDestinationFromWallet(adapter,'bark','mainnet')).toEqual({type:'bark',serverKey:key,address:'ark1public'});
});
test('rejects network mismatch and wallet changes during address generation',async()=>{
 const info={connected:true,network:'signet',nodeId:key};
 const adapter={getConnectionInfo:jest.fn().mockResolvedValue(info),getReceiveAddress:jest.fn().mockResolvedValue({address:'ark1public'})};
 await expect(receiverDestinationFromWallet(adapter,'bark','mainnet')).rejects.toThrow('Bark is on signet, your receiving node on mainnet');expect(adapter.getReceiveAddress).not.toHaveBeenCalled();
 adapter.getConnectionInfo.mockResolvedValueOnce(info).mockResolvedValueOnce({...info,nodeId:'cd'.repeat(32)});
 await expect(receiverDestinationFromWallet(adapter,'bark','signet')).rejects.toThrow('changed');
});
test('syncs once when the server key is not known yet',async()=>{
 const sync=jest.fn().mockResolvedValue(undefined);
 const adapter={backend:{sync},getConnectionInfo:jest.fn().mockResolvedValueOnce({connected:true,network:'signet'}).mockResolvedValue({connected:true,network:'signet',nodeId:key}),getReceiveAddress:jest.fn().mockResolvedValue({address:'tark1public'})};
 expect(await receiverDestinationFromWallet(adapter,'bark','signet')).toEqual({type:'bark',serverKey:key,address:'tark1public'});
 expect(sync).toHaveBeenCalledTimes(1);
});
