/* McCluster Control Room voice transport.
   Thin browser capability only: microphone transcription and speech playback
   feed the canonical resident AI chat. No second model, queue, or datastore. */
(function () {
  "use strict";

  window.CR = window.CR || {};

  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var synth = window.speechSynthesis || null;
  var activeRecognition = null;
  var activeUtterance = null;

  function capabilities() {
    return {
      recognition: Boolean(Recognition),
      synthesis: Boolean(synth && window.SpeechSynthesisUtterance),
      recognitionEngine: Recognition
        ? (window.SpeechRecognition ? "browser-speech-recognition" : "webkit-speech-recognition")
        : null
    };
  }

  function stopListening() {
    if (!activeRecognition) return;
    var current = activeRecognition;
    activeRecognition = null;
    current.__mcclusterDiscard = false;
    try { current.stop(); } catch (e) {
      try { current.abort(); } catch (ignore) {}
    }
  }

  function cancelListening() {
    if (!activeRecognition) return;
    var current = activeRecognition;
    activeRecognition = null;
    current.__mcclusterDiscard = true;
    try { current.abort(); } catch (e) {
      try { current.stop(); } catch (ignore) {}
    }
  }

  function cancelSpeech() {
    activeUtterance = null;
    if (synth) {
      try { synth.cancel(); } catch (ignore) {}
    }
  }

  function startListening(options) {
    options = options || {};
    if (!Recognition) {
      if (options.onError) options.onError(new Error("Speech recognition is not available in this browser."));
      return false;
    }

    stopListening();
    cancelSpeech();

    var recognition = new Recognition();
    var finalText = "";
    var interimText = "";
    var ended = false;
    activeRecognition = recognition;

    recognition.lang = options.lang || navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = function () {
      if (options.onState) options.onState({ listening: true, speaking: false });
    };

    recognition.onresult = function (event) {
      interimText = "";
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var result = event.results[i];
        var transcript = result && result[0] ? String(result[0].transcript || "") : "";
        if (result.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      var combined = (finalText + (finalText && interimText ? " " : "") + interimText).trim();
      if (combined && options.onTranscript) {
        options.onTranscript({ text: combined, final: false, interim: interimText.trim() });
      }
    };

    recognition.onerror = function (event) {
      var code = event && event.error ? String(event.error) : "speech-recognition-error";
      if (code === "aborted") return;
      if (options.onError) options.onError(Object.assign(new Error("Voice input failed: " + code), { code: code }));
    };

    recognition.onend = function () {
      if (ended) return;
      ended = true;
      if (activeRecognition === recognition) activeRecognition = null;
      if (options.onState) options.onState({ listening: false, speaking: false });
      if (recognition.__mcclusterDiscard) return;
      var text = (finalText || interimText).trim();
      if (text && options.onTranscript) {
        options.onTranscript({ text: text, final: true, interim: "" });
      }
    };

    try {
      recognition.start();
      return true;
    } catch (error) {
      activeRecognition = null;
      if (options.onError) options.onError(error);
      return false;
    }
  }

  function preferredVoice(lang) {
    if (!synth || !synth.getVoices) return null;
    var voices = synth.getVoices() || [];
    if (!voices.length) return null;
    var wanted = String(lang || navigator.language || "en-US").toLowerCase();
    var short = wanted.split("-")[0];
    return voices.find(function (voice) {
      return voice.lang && voice.lang.toLowerCase() === wanted;
    }) || voices.find(function (voice) {
      return voice.lang && voice.lang.toLowerCase().split("-")[0] === short;
    }) || voices.find(function (voice) { return voice.default; }) || voices[0];
  }

  function speak(text, options) {
    options = options || {};
    var value = String(text || "").trim();
    if (!value) return false;
    if (!synth || !window.SpeechSynthesisUtterance) {
      if (options.onError) options.onError(new Error("Speech playback is not available in this browser."));
      return false;
    }

    stopListening();
    cancelSpeech();

    var utterance = new SpeechSynthesisUtterance(value);
    activeUtterance = utterance;
    utterance.lang = options.lang || navigator.language || "en-US";
    utterance.rate = Number(options.rate || 1);
    utterance.pitch = Number(options.pitch || 1);
    var voice = preferredVoice(utterance.lang);
    if (voice) utterance.voice = voice;

    utterance.onstart = function () {
      if (options.onState) options.onState({ listening: false, speaking: true });
    };
    utterance.onend = function () {
      if (activeUtterance === utterance) activeUtterance = null;
      if (options.onState) options.onState({ listening: false, speaking: false });
    };
    utterance.onerror = function (event) {
      var code = event && event.error ? String(event.error) : "speech-synthesis-error";
      var wasCanceled = activeUtterance !== utterance && (code === "canceled" || code === "interrupted");
      if (activeUtterance === utterance) activeUtterance = null;
      if (options.onState) options.onState({ listening: false, speaking: false });
      if (!wasCanceled && options.onError) {
        options.onError(Object.assign(new Error("Voice playback failed: " + code), { code: code }));
      }
    };

    synth.speak(utterance);
    return true;
  }

  window.CR.voice = {
    capabilities: capabilities,
    startListening: startListening,
    stopListening: stopListening,
    cancelListening: cancelListening,
    speak: speak,
    cancelSpeech: cancelSpeech
  };
})();