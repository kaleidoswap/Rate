const mockSynth = jest.fn();
const mockSystem = jest.fn();
const mockStop = jest.fn();
let mockStatus: (status: any) => void;
const mockPlayer = {play:jest.fn(),pause:jest.fn(),remove:jest.fn(),addListener:jest.fn((_name,cb)=>{mockStatus=cb;return {remove:jest.fn()}})};
jest.mock('expo-audio',()=>({createAudioPlayer:()=>mockPlayer,setAudioModeAsync:async()=>{}}));
jest.mock('expo-file-system',()=>({Paths:{cache:'cache'},Directory:class {exists=true;create(){}},File:class {uri='cache/speech.wav';write(){}delete(){}}}));
jest.mock('../services/QVACService',()=>({__esModule:true,default:{getInstance:()=>({synthesizeSpeech:mockSynth,getTtsEngine:()=> 'supertonic'})}}));
jest.mock('../services/speech',()=>({speakBest:(...args:any[])=>mockSystem(...args),stopSpeaking:()=>mockStop()}));
import {speak,stopSpeak} from '../services/qvacTts';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockSystem.mockResolvedValue(undefined)});
afterEach(async()=>{await stopSpeak();jest.useRealTimers()});
test('Italian preserves accents and uses system voice and word events',async()=>{
 const level=jest.fn(),done=jest.fn();
 await speak('È già pronto, perché sì.',{language:'it-IT',onLevel:level,onDone:done});
 expect(mockSynth).not.toHaveBeenCalled();
 expect(mockSystem.mock.calls[0][0]).toBe('È già pronto, perché sì.');
 const options=mockSystem.mock.calls[0][1];expect(options.language).toBe('it-IT');
 options.onBoundary({charLength:4,charIndex:0});expect(level).toHaveBeenLastCalledWith(.75);
 jest.advanceTimersByTime(200);expect(level).toHaveBeenLastCalledWith(0);
 options.onDone();expect(done).toHaveBeenCalledTimes(1);
});
test('cancelling pending synthesis cannot start playback or resume microphone',async()=>{
 let finish:any;mockSynth.mockReturnValue(new Promise(r=>finish=r));const done=jest.fn();
 const pending=speak('Hello',{language:'en-US',onDone:done});await flush();
 await stopSpeak();finish({pcm:[100,200],sampleRate:16000});await pending;
 expect(mockPlayer.play).not.toHaveBeenCalled();expect(done).not.toHaveBeenCalled();
});
test('PCM playback emits energy, silence and finishes; stopping settles playback',async()=>{
 mockSynth.mockResolvedValue({pcm:[...Array(400).fill(16000),...Array(400).fill(0)],sampleRate:16000});
 const level=jest.fn(),done=jest.fn();const pending=speak('Hello',{onLevel:level,onDone:done});await flush();
 mockStatus({playing:true,currentTime:0});expect(level).toHaveBeenLastCalledWith(1);
 mockStatus({playing:true,currentTime:.025});expect(level).toHaveBeenLastCalledWith(0);
 await stopSpeak();await pending;expect(done).not.toHaveBeenCalled();expect(mockPlayer.remove).toHaveBeenCalled();
});
