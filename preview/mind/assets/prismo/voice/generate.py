"""Build prerecorded Italian demo speech; key stays in the environment."""
import os, json, urllib.request, subprocess, array, math
from pathlib import Path
OUT=Path(__file__).parent
clips={
 'request': ('EXAVITQu4vr4xnSDxMaL','Prismo, qual è il mio saldo?'),
 'balance': ('bIHbv24MWmeRgasZH58o','Hai centoventicinquemila satoshi. Ottantamila sono su Spark e quarantacinquemila su Lightning. Vuoi preparare un pagamento?'),
 'preparing': ('bIHbv24MWmeRgasZH58o','Certo! Preparo il pagamento per Alice. Prima di inviare, ti mostro tutti i dettagli.'),
 'review': ('bIHbv24MWmeRgasZH58o','Controlla il destinatario e l’importo. Puoi modificarlo oppure annullare. Per continuare, premi Conferma. Decidi sempre tu.'),
 'done': ('bIHbv24MWmeRgasZH58o','Perfetto! Hai confermato il pagamento demo ad Alice. Questa era una simulazione: nessun denaro è stato inviato.'),
}
manifest={}
for name,(voice,text) in clips.items():
 path=OUT/(name+'.mp3')
 if not path.exists():
  body={'text':text,'model_id':'eleven_multilingual_v2','voice_settings':{'stability':0.55,'similarity_boost':0.75,'style':0.15,'speed':0.97,'use_speaker_boost':True}}
  req=urllib.request.Request('https://api.elevenlabs.io/v1/text-to-speech/'+voice+'?output_format=mp3_44100_128',data=json.dumps(body).encode(),headers={'xi-api-key':os.environ['ELEVENLABS_API_KEY'],'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=90) as r: path.write_bytes(r.read())
 pcm=subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-f','s16le','-ac','1','-ar','16000','-'])
 samples=array.array('h',pcm);hop=400
 rms=[math.sqrt(sum((x/32768)**2 for x in samples[i:i+hop])/len(samples[i:i+hop])) for i in range(0,len(samples),hop)]
 peak=sorted(rms)[int(len(rms)*.95)] or 1
 levels=[round(min(1,max(0,(x-.006)/(peak*.9))),3) for x in rms]
 manifest[name]={'text':text,'voice':voice,'model':'eleven_multilingual_v2','frameSeconds':.025,'duration':len(samples)/16000,'levels':levels,'url':'./voice/'+name+'.mp3'}
 print(name,round(len(samples)/16000,2),'seconds',flush=True)
(OUT/'clips.json').write_text(json.dumps(manifest,ensure_ascii=False))
