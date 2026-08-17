# Direcht - P2P Chat SPA 🔐

A fully end-to-end encrypted peer-to-peer chat application built with WebRTC. No server required after the initial page load—all communication is direct browser-to-browser.

## Features ✨

- **True P2P Communication**: Uses WebRTC for direct peer connections
- **End-to-End Encrypted**: Data only flows between peers, never through servers
- **Minimal Signaling**: PeerJS cloud used only for initial peer discovery
- **Usernames**: Set your identity and see who you're chatting with
- **Text Messages**: Real-time text messaging
- **File Transfer**: Send files with transfer progress tracking
- **Chat History**: The last 100 text messages are stored locally on this device
- **Beautiful UI**: Modern dark theme with smooth animations
- **Copy-to-Clipboard**: One-click peer ID sharing
- **Connection Feedback**: Clear connecting, timeout, reconnecting, and connected states

## Local Setup

### Prerequisites
- Python 3.x

### Installation & Running Locally

```bash
python -m http.server 3000
```

Open the app at `http://localhost:3000/`.

## How to Use

1. **Share Your ID**: Your peer ID is displayed at the top. Share it with someone
2. **Connect**: Paste their ID, scan their QR code, or drag a file into an active chat. Review a scanned ID, then click "Connect"
3. **Chat**: Send text messages and files in real-time
4. **Disconnect**: Click "Disconnect" when done (clears chat history locally)

## Tech Stack

- **Frontend**: Vanilla JavaScript (no frameworks)
- **P2P**: WebRTC via [PeerJS](https://peerjs.com/)
- **Signaling**: PeerJS Cloud (free tier)
- **Storage**: Browser localStorage
- **Styling**: CSS3 with gradients and animations

## Security Notes

✅ **What's Secure:**
- All messages encrypted end-to-end (WebRTC encryption)
- No server stores messages
- No user tracking
- Peer IDs are random and temporary

⚠️ **Limitations:**
- PeerJS cloud sees connection metadata (minimal info)
- Chat history is stored in this browser's local storage; it is cleared when you use Disconnect or Clear chat history
- Peer IDs are not human-readable (intentional)

## Troubleshooting

### "Can't connect to peer"
- Verify the peer ID is correct
- Both peers must have the page open
- Check that both are connected to the internet
- Peer might be behind a restrictive firewall
- After a connection timeout, check the ID and choose Connect again

### "Files not transferring"
- Try smaller files first (test with <10MB)
- Keep browser window in focus
- Check browser DevTools console for errors
- The progress area identifies the file currently being sent or received

### "Chat history not saving"
- Check browser localStorage limits
- Try clearing some history with "Clear chat history" button
- Some browsers limit storage to ~5-10MB

## Privacy Policy

This app operates entirely client-side. We do not:
- Track users
- Store messages
- Collect IP addresses
- Use analytics
- Collect any personal data

Visit [PeerJS privacy](https://peerjs.com/) for their signaling service privacy policy.

## License

MIT - Free to use and modify

## Contributing

Pull requests welcome! Feel free to add features like:
- Voice/video calls
- Message search
- User avatars
- Emoji picker
- Dark/light theme toggle

## Support

Found a bug? Have a feature request?
- Check GitHub Issues
- Create a new issue with details

---

**Built with ❤️ for privacy-conscious developers**
