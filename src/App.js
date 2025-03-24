import React, { useState, useRef } from "react";
import { io } from "socket.io-client";

const socket = io("https://file-share-backend-90mg.onrender.com"); // Connect to backend

const App = () => {
    const peerRef = useRef(null);
    const fileInputRef = useRef(null);
    const dataChannelRef = useRef(null);
    const [status, setStatus] = useState("Waiting for connection...");
    const [role, setRole] = useState(null);
    const [peerConnected, setPeerConnected] = useState(false);
    const pendingCandidates = useRef([]);
    const [fileSize, setFileSize] = useState(0);
const [transferred, setTransferred] = useState(0);
const [progress, setProgress] = useState(0);
const [downloadComplete, setDownloadComplete] = useState(false);

    // Create Peer Connection
    const createPeerConnection = () => {
        peerRef.current = new RTCPeerConnection({
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" }, // Free STUN server
                {
                    urls: "relay1.expressturn.com:3478",
                    username: "ef5DTVKLHB98TP7VT7",
                    credential: "B535vB6Wr0eeZdZV"
                }
            ]
        });
    
        // Handle ICE candidates
        peerRef.current.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit("candidate", event.candidate);
            }
        };
    
        // Handle DataChannel when receiving a connection
        peerRef.current.ondatachannel = (event) => {
            setRole("Receiver");
            dataChannelRef.current = event.channel;
    
            const receivedChunks = [];
            let receivedBytes = 0;
            let expectedFileSize = 0;
            let receivedFileName = "received-file"; // Default filename
    
            event.channel.onmessage = (event) => {
                if (typeof event.data === "string") {
                    if (event.data.startsWith("FILENAME:")) {
                        receivedFileName = event.data.split(":")[1]; // Extract filename
                        return;
                    }
                    if (event.data.startsWith("SIZE:")) {
                        expectedFileSize = parseInt(event.data.split(":")[1]);
                        setFileSize(expectedFileSize);
                        return;
                    }
                    if (event.data.startsWith("EOF")) {
                        console.log("✅ End of file detected, assembling file...");
                        
                        const fileBlob = new Blob(receivedChunks);
                        const url = URL.createObjectURL(fileBlob);
                        
                        setStatus("✅ File received!");
                        setDownloadComplete(true);
    
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = receivedFileName; // Use extracted filename
                        document.body.appendChild(link);
                        link.click();
    
                        receivedChunks.length = 0; // Clear memory
                        return;
                    }
                }
    
                receivedChunks.push(event.data);
                receivedBytes += event.data.byteLength;
    
                // Update UI progress
                setTransferred(receivedBytes);
                setProgress(Math.min((receivedBytes / expectedFileSize) * 100, 100));
    
                console.log(`📥 Received chunk (${event.data.byteLength} bytes), total: ${receivedBytes} bytes`);
            };
    
            event.channel.onclose = () => {
                console.log("❌ Data channel closed.");
                setStatus("Connection closed.");
            };
        };
    };
    

    // Start Connection (Sender)
    const startConnection = async () => {
      if (!peerRef.current) createPeerConnection();
  
      if (peerRef.current.signalingState !== "stable") {
          console.warn("⚠️ Cannot start connection, already in progress:", peerRef.current.signalingState);
          return;
      }
  
      setRole("Sender");
  
      const dataChannel = peerRef.current.createDataChannel("fileTransfer");
  
      dataChannel.onopen = () => {
          console.log("✅ Data channel opened.");
          setStatus("Connection established!");
          setPeerConnected(true);
      };
  
      dataChannel.onclose = () => {
          console.log("❌ Data channel closed.");
          setStatus("Connection closed.");
          setPeerConnected(false);
      };
  
      dataChannel.onerror = (error) => {
          console.error("⚠️ DataChannel Error:", error);
          setStatus("Data channel error.");
      };
  
      dataChannelRef.current = dataChannel; // Store the reference
  
      const offer = await peerRef.current.createOffer();
      await peerRef.current.setLocalDescription(offer);
  
      socket.emit("offer", offer);
  };
  

    // Handle Incoming Offer (Receiver)
    socket.on("offer", async (offer) => {
      if (!peerRef.current) createPeerConnection();
  
      if (peerRef.current.signalingState !== "stable") {
          console.warn("⚠️ Ignoring offer. Signaling state:", peerRef.current.signalingState);
          return;
      }
  
      setRole("Receiver");
  
      await peerRef.current.setRemoteDescription(new RTCSessionDescription(offer));
      console.log("✅ Remote description set.");
  
      const answer = await peerRef.current.createAnswer();
      await peerRef.current.setLocalDescription(answer);
      console.log("✅ Local description set for answer.");
  
      socket.emit("answer", answer);
  
      processPendingCandidates(); // Apply stored ICE candidates
  });

    // Handle Answer
    socket.on("answer", async (answer) => {
      if (!peerRef.current) {
          console.error("❌ Peer connection does not exist.");
          return;
      }
  
      console.log("🛠 Current signaling state before setting answer:", peerRef.current.signalingState);
  
      if (peerRef.current.signalingState !== "have-local-offer") {
          console.warn("⚠️ Ignoring answer because state is not 'have-local-offer':", peerRef.current.signalingState);
          return;
      }
  
      try {
          await peerRef.current.setRemoteDescription(new RTCSessionDescription(answer));
          console.log("✅ Remote description set successfully.");
      } catch (error) {
          console.error("❌ Error setting remote description:", error);
      }
  });
  

    // Handle ICE Candidates
    

socket.on("candidate", async (candidate) => {
    if (peerRef.current && peerRef.current.remoteDescription) {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("✅ ICE candidate added.");
    } else {
        console.warn("⚠️ Storing ICE candidate for later.");
        pendingCandidates.push(candidate);
    }
});

// Apply stored candidates when remote description is set
const processPendingCandidates = () => {
    while (pendingCandidates.length > 0) {
        peerRef.current.addIceCandidate(new RTCIceCandidate(pendingCandidates.shift()));
    }
};

    // Send File
    const sendFile = () => {
      const file = fileInputRef.current.files[0];
      if (!file) {
          console.error("❌ No file selected!");
          return;
      }
  
      if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") {
          console.error("❌ Data channel is not open! Current state:", dataChannelRef.current?.readyState);
          setStatus("Error: Connection not ready!");
          return;
      }
  
      setFileSize(file.size);
      setTransferred(0);
      setProgress(0);
  
      const chunkSize = 128 * 1024; // 16 KB chunks
      let offset = 0;
  
      const reader = new FileReader();
  
      // Send file metadata first (filename & size)
      dataChannelRef.current.send(`FILENAME:${file.name}`);
      dataChannelRef.current.send(`SIZE:${file.size}`);
  
      reader.onload = (event) => {
          const buffer = event.target.result;
  
          const sendChunk = () => {
              if (offset < buffer.byteLength) {
                  const chunk = buffer.slice(offset, offset + chunkSize);
                  dataChannelRef.current.send(chunk);
                  offset += chunkSize;
  
                  // Update progress
                  setTransferred(offset);
                  setProgress(Math.min((offset / file.size) * 100, 100));
  
                  setTimeout(sendChunk, 50); // Prevent buffer overload
              } else {
                  dataChannelRef.current.send("EOF"); // Signal end of file
                  setStatus("✅ File sent!");
                  console.log("📤 File transfer complete.");
              }
          };
  
          sendChunk();
      };
  
      reader.readAsArrayBuffer(file);
  };
  

    return (
      <div>
      <h2>WebRTC File Transfer</h2>
      <button onClick={startConnection} disabled={peerConnected}>Start Connection</button>
      <br />
  
      {role === "Sender" && (
          <>
              <input type="file" ref={fileInputRef} />
              <button onClick={sendFile}>Send File</button>
          </>
      )}
  
      <p>Status: {status}</p>
      <p>Role: {role ? role : "Waiting for connection..."}</p>
  
      {fileSize > 0 && (
          <div>
              <p>File Size: {(fileSize / (1024 * 1024)).toFixed(2)} MB</p>
              <p>Transferred: {(transferred / (1024 * 1024)).toFixed(2)} MB</p>
              <progress value={progress} max="100"></progress>
              <p>{Math.round(progress)}% completed</p>
  
              {downloadComplete && <p>✅ Download complete!</p>}
          </div>
      )}
  </div>
  
  
    );
};

export default App;