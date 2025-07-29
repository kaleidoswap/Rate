import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import { WebView } from 'react-native-webview';
import { View, StyleSheet } from 'react-native';

interface SpeechToTextProps {
  onResult: (text: string) => void;
  onPartialResult: (text: string) => void;
  onError: (error: string) => void;
  onStart: () => void;
  onEnd: () => void;
}

export interface SpeechToTextRef {
  startListening: () => void;
  stopListening: () => void;
}

const SpeechToText = forwardRef<SpeechToTextRef, SpeechToTextProps>(
  ({ onResult, onPartialResult, onError, onStart, onEnd }, ref) => {
    const webViewRef = useRef<WebView>(null);

    useImperativeHandle(ref, () => ({
      startListening: () => {
        webViewRef.current?.postMessage(JSON.stringify({ action: 'start' }));
      },
      stopListening: () => {
        webViewRef.current?.postMessage(JSON.stringify({ action: 'stop' }));
      },
    }));

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Speech Recognition</title>
</head>
<body>
    <script>
        let recognition = null;
        let isListening = false;
        let finalTranscript = '';
        let lastProcessedIndex = 0;

        // Initialize Speech Recognition
        function initializeSpeechRecognition() {
            if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'error',
                    message: 'Speech recognition not supported in this browser'
                }));
                return false;
            }

            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            recognition = new SpeechRecognition();

            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';
            recognition.maxAlternatives = 1;

            recognition.onstart = function() {
                console.log('Speech recognition started');
                isListening = true;
                finalTranscript = '';
                lastProcessedIndex = 0;
                window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'start'
                }));
            };

            recognition.onresult = function(event) {
                let newFinalTranscript = '';
                let interimTranscript = '';

                // Process only new results to avoid duplicates
                for (let i = lastProcessedIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        newFinalTranscript += transcript;
                        lastProcessedIndex = i + 1;
                    } else {
                        interimTranscript += transcript;
                    }
                }

                // Only send final results if we have new ones
                if (newFinalTranscript.trim()) {
                    finalTranscript += newFinalTranscript;
                    console.log('Sending final result:', newFinalTranscript.trim());
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'result',
                        text: newFinalTranscript.trim()
                    }));
                }

                // Send interim results for real-time feedback
                if (interimTranscript.trim()) {
                    console.log('Sending partial result:', interimTranscript.trim());
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'partial',
                        text: interimTranscript.trim()
                    }));
                }
            };

            recognition.onerror = function(event) {
                console.error('Speech recognition error:', event.error);
                isListening = false;
                finalTranscript = '';
                lastProcessedIndex = 0;
                window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'error',
                    message: event.error || 'Speech recognition error'
                }));
            };

            recognition.onend = function() {
                console.log('Speech recognition ended');
                isListening = false;
                
                // Send any remaining final transcript
                if (finalTranscript.trim()) {
                    console.log('Sending final transcript on end:', finalTranscript.trim());
                }
                
                finalTranscript = '';
                lastProcessedIndex = 0;
                
                window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'end'
                }));
            };

            return true;
        }

        // Handle messages from React Native
        document.addEventListener('message', function(event) {
            handleMessage(event.data);
        });

        window.addEventListener('message', function(event) {
            handleMessage(event.data);
        });

        function handleMessage(data) {
            try {
                const message = JSON.parse(data);
                
                if (message.action === 'start') {
                    if (!recognition) {
                        if (!initializeSpeechRecognition()) {
                            return;
                        }
                    }
                    
                    if (!isListening) {
                        // Reset state before starting
                        finalTranscript = '';
                        lastProcessedIndex = 0;
                        recognition.start();
                    }
                } else if (message.action === 'stop') {
                    if (recognition && isListening) {
                        recognition.stop();
                    }
                }
            } catch (error) {
                console.error('Error handling message:', error);
                window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'error',
                    message: 'Error processing message: ' + error.message
                }));
            }
        }

        // Initialize on load
        window.onload = function() {
            console.log('WebView loaded, initializing speech recognition...');
            initializeSpeechRecognition();
        };
    </script>
</body>
</html>
    `;

    const handleMessage = (event: any) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        
        switch (data.type) {
          case 'start':
            onStart();
            break;
          case 'result':
            onResult(data.text);
            break;
          case 'partial':
            onPartialResult(data.text);
            break;
          case 'error':
            onError(data.message);
            break;
          case 'end':
            onEnd();
            break;
          default:
            console.log('Unknown message type:', data.type);
        }
      } catch (error) {
        console.error('Error parsing WebView message:', error);
        onError('Error parsing speech recognition result');
      }
    };

    return (
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          source={{ html: htmlContent }}
          onMessage={handleMessage}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={false}
          style={styles.webView}
          onError={(error) => {
            console.error('WebView error:', error);
            onError('WebView failed to load');
          }}
          onHttpError={(error) => {
            console.error('WebView HTTP error:', error);
            onError('WebView HTTP error');
          }}
        />
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: -1000,
    top: -1000,
    width: 1,
    height: 1,
  },
  webView: {
    width: 1,
    height: 1,
  },
});

export default SpeechToText; 