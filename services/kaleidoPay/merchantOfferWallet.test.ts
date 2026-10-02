import {receiverDestinationFromWallet} from './merchantOfferWallet';
const key='ab'.repeat(32);
test('imports SDK address and normalizes the compressed server key',async()=>{
 const adapter={getConnectionInfo:jest.fn().mockResolvedValue({connected:true,network:'bitcoin',nodeId:'02'+key}),getReceiveAddress:jest.fn().mockResolvedValue({address:'ark1public'})};
 expect(await receiverDestinationFromWallet(adapter,'bark','mainnet')).toEqual({type:'bark',serverKey:key,address:'ark1public'});
});
test('rejects network mismatch and wallet changes during address generation',async()=>{
 const info={connected:true,network:'signet',nodeId:key};
 const adapter={getConnectionInfo:jest.fn().mockResolvedValue(info),getReceiveAddress:jest.fn().mockResolvedValue({address:'ark1public'})};
 await expect(receiverDestinationFromWallet(adapter,'bark','mainnet')).rejects.toThrow('Connect Bark');expect(adapter.getReceiveAddress).not.toHaveBeenCalled();
 adapter.getConnectionInfo.mockResolvedValueOnce(info).mockResolvedValueOnce({...info,nodeId:'cd'.repeat(32)});
 await expect(receiverDestinationFromWallet(adapter,'bark','signet')).rejects.toThrow('changed');
});
