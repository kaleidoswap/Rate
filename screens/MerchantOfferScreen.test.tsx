import React from 'react';
import {render,fireEvent,act} from '@testing-library/react-native';
import MerchantOfferScreen from './MerchantOfferScreen';
import {createMerchantOffer,listMerchantReceipts} from '../services/kaleidoPay/merchantOffer';
import {loadMerchantOffer,saveMerchantOffer} from '../services/kaleidoPay/merchantOfferStore';
import {loadReceiverPreferences,saveReceiverPreferences,defaultReceiverPreferences} from '../services/kaleidoPay/merchantOfferPreferences';
jest.mock('../services/kaleidoPay/merchantOfferPreferences',()=>({...jest.requireActual('../services/kaleidoPay/merchantOfferPreferences'),loadReceiverPreferences:jest.fn(),saveReceiverPreferences:jest.fn()}));
const mockConnection={id:'ab'.repeat(32),walletPubkey:'ab'.repeat(32),network:'regtest',alias:'Merchant'};
jest.mock('../store/hooks',()=>({useAppSelector:(f:any)=>f({nostr:{nwcConnections:[mockConnection],selectedNwcConnectionId:mockConnection.id}})}));
jest.mock('../components/ScreenHeader',()=>({ScreenHeader:'ScreenHeader'}));
jest.mock('../components/receive/ReceiveQr',()=>({ReceiveQr:({value}:any)=>{const {Text}=require('react-native');return <Text>{value}</Text>}}));
jest.mock('../components/Button',()=>({Button:({title,onPress,disabled}:any)=>{const {Text,TouchableOpacity}=require('react-native');return <TouchableOpacity onPress={onPress} disabled={disabled}><Text>{title}</Text></TouchableOpacity>}}));
jest.mock('../services/nwc/connectionStore',()=>({loadNwcCredential:jest.fn().mockResolvedValue('private-credential')}));
jest.mock('../services/nwc/NWCExternalClient',()=>({parseNwcUri:()=>({walletPubkey:'ab'.repeat(32)}),NWCClient:class {close(){} request(){}}}));
jest.mock('../services/kaleidoPay/merchantOffer',()=>({createMerchantOffer:jest.fn(),listMerchantReceipts:jest.fn()}));
jest.mock('../services/kaleidoPay/merchantOfferStore',()=>({loadMerchantOffer:jest.fn(),saveMerchantOffer:jest.fn(),merchantPaymentCode:(value:any)=>value.offer}));
const saved={offer:'lno1saved',offer_id:'cd'.repeat(32),network:'regtest',description:'Coffee',amount:100000};
beforeEach(()=>{jest.clearAllMocks();(loadReceiverPreferences as jest.Mock).mockResolvedValue(defaultReceiverPreferences(mockConnection.network));(saveReceiverPreferences as jest.Mock).mockResolvedValue(undefined);(loadMerchantOffer as jest.Mock).mockResolvedValue(null);(saveMerchantOffer as jest.Mock).mockResolvedValue(undefined)});
test('reopens the saved QR and reads receipts without creating another offer',async()=>{
 (loadMerchantOffer as jest.Mock).mockResolvedValue(saved);
 (listMerchantReceipts as jest.Mock).mockResolvedValue([{payment_hash:'ef'.repeat(32),amount:100000,state:'settled'}]);
 const view=render(<MerchantOfferScreen navigation={{goBack:jest.fn()}}/>);await act(async()=>{});
 expect(view.getByText('lno1saved')).toBeTruthy();expect(createMerchantOffer).not.toHaveBeenCalled();
 expect(view.getByText('Check payments to load Lightning receipts')).toBeTruthy();
 await act(async()=>{fireEvent.press(view.getByText('Check received payments'))});
 expect(view.getByText('1 completed Lightning payments')).toBeTruthy();
});
test('persists an offer before showing the reusable QR',async()=>{
 (createMerchantOffer as jest.Mock).mockResolvedValue(saved);
 const view=render(<MerchantOfferScreen navigation={{goBack:jest.fn()}}/>);await act(async()=>{});
 fireEvent.changeText(view.getByLabelText('Reusable QR amount in sats'),'100');
 await act(async()=>{fireEvent.press(view.getByText('Create reusable QR'))});
 expect(saveMerchantOffer).toHaveBeenCalledWith(mockConnection.id,expect.objectContaining({offer:'lno1saved',network:'regtest'}));
 expect(view.getByText('lno1saved')).toBeTruthy();
});
test('storage failure never displays an unpersisted QR',async()=>{
 (createMerchantOffer as jest.Mock).mockResolvedValue(saved);(saveMerchantOffer as jest.Mock).mockRejectedValue(new Error('Storage unavailable'));
 const view=render(<MerchantOfferScreen navigation={{goBack:jest.fn()}}/>);await act(async()=>{});
 await act(async()=>{fireEvent.press(view.getByText('Create reusable QR'))});
 expect(view.queryByText('lno1saved')).toBeNull();expect(view.getByText('Storage unavailable')).toBeTruthy();
});

test('saves ordered preferences without replacing an existing QR',async()=>{
 (loadMerchantOffer as jest.Mock).mockResolvedValue(saved);
 const view=render(<MerchantOfferScreen navigation={{goBack:jest.fn()}}/>);await act(async()=>{});
 fireEvent.press(view.getByText('Edit receiving preferences'));
 fireEvent.press(view.getByText('Add Bark address'));
 fireEvent.changeText(view.getByLabelText('Bark receiving address'),'bark-public');
 fireEvent.changeText(view.getByLabelText('Bark server public key'),'ab'.repeat(32));
 fireEvent.press(view.getByText('Move Lightning up'));
 await act(async()=>{fireEvent.press(view.getByText('Save preferences'))});
 expect(saveReceiverPreferences).toHaveBeenCalledWith(mockConnection.id,expect.objectContaining({destinations:[{type:'lightning',source:'bolt12_offer'},{type:'bark',address:'bark-public',serverKey:'ab'.repeat(32)}]}));
 expect(view.getByText('lno1saved')).toBeTruthy();expect(createMerchantOffer).not.toHaveBeenCalled();
});
test('failed replacement preserves old QR and retries storage without issuing again',async()=>{
 (loadMerchantOffer as jest.Mock).mockResolvedValue(saved);
 (createMerchantOffer as jest.Mock).mockResolvedValue({...saved,offer:'lno1updated'});
 (saveMerchantOffer as jest.Mock).mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValueOnce(undefined);
 const view=render(<MerchantOfferScreen navigation={{goBack:jest.fn()}}/>);await act(async()=>{});
 fireEvent.press(view.getByText('Edit receiving preferences'));
 await act(async()=>{fireEvent.press(view.getByText('Create updated QR'))});
 expect(view.getByText('lno1saved')).toBeTruthy();expect(view.queryByText('lno1updated')).toBeNull();
 await act(async()=>{fireEvent.press(view.getByText('Create updated QR'))});
 expect(view.getByText('lno1updated')).toBeTruthy();expect(createMerchantOffer).toHaveBeenCalledTimes(1);
});
