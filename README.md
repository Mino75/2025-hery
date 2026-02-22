# 🥊 Hery - Multi-Language  Training Coach

## 📋 Table of Contents
- [📖 About](#-about)
- [🚀 Getting Started](#-getting-started)
- [🔨 How to Build / How to Run](#-how-to-build--how-to-run)
- [🏗️ Project Structure](#️-project-structure)
- [🎯 Features](#-features)
- [🔧 Technical Architecture](#-technical-architecture)
- [📚 Dependencies](#-dependencies)
- [🐳 Docker Deployment](#-docker-deployment)
- [💡 Usage](#-usage)
- [🌐 Supported Languages](#-supported-languages)
- [🥋 Training Programs](#-training-programs)
- [📱 Progressive Web App](#-progressive-web-app)
- [📄 License](#-license)

## 📖 About

Hery (strength in Malagasy) is an advanced Progressive Web App (PWA) that serves as your  training coach. With multi-language voice coaching, comprehensive workout tracking, and sophisticated caching strategies, Hery provides an immersive training experience for various martial arts disciplines including Boxing, Judo, Wushu (Kung Fu), and general fitness routines.

The application features intelligent voice coaching in 6 languages, robust offline functionality, and a sophisticated caching system designed for poor network conditions. Whether you're a beginner or experienced martial artist, Hery adapts to your training needs with personalized coaching and progress tracking.

## 🚀 Getting Started

### Prerequisites
- Node.js (v20 or higher)
- npm package manager
- Modern web browser with:
  - Web Speech API support
  - IndexedDB support
  - Service Worker support
  - Wake Lock API (optional)

### 📦 Installation
```bash
git clone https://github.com/your-repo/hery.git
cd hery
npm install
```

## 🔨 How to Build / How to Run

### Development Mode
```bash
# Start the development server
node server.js
```
The application will be available at `http://localhost:3000`

### Production Mode
```bash
# Install production dependencies
npm install --production

# Set environment variables (optional)
export CACHE_VERSION=v3
export APP_NAME=hery
export PORT=3000

# Start the server
node server.js
```

### Environment Variables
- `CACHE_VERSION`: Service worker cache version (default: v2)
- `APP_NAME`: Application name for caching (default: hery)
- `PORT`: Server port (default: 3000)
- `SW_FIRST_TIME_TIMEOUT`: Network timeout for new users (default: 20000ms)
- `SW_RETURNING_USER_TIMEOUT`: Network timeout for returning users (default: 5000ms)
- `SW_ENABLE_LOGS`: Enable service worker logs (default: true)

## 🏗️ Project Structure

```
hery/
├── index.html              # Main application interface
├── main.js                 # Core training logic and state management
├── styles.js               # Dynamic CSS styling system
├── server.js               # Express server with cache injection
├── service-worker.js       # Advanced PWA service worker
├── trainings.json          # Comprehensive exercise database
├── manifest.json           # PWA manifest configuration
├── package.json            # Dependencies and scripts
├── dockerfile             # Multi-stage Docker configuration
├── .gitignore             # Version control ignore patterns
├── LICENSE                # MIT license
├── README.md              # Project documentation
└── .github/workflows/     # CI/CD automation
    └── main.yaml          # Docker build and push workflow
```

## 🎯 Features

### 🎤 Multi-Language Voice Coaching
- **6 Languages**: English, French, Spanish, Chinese, Japanese, Russian
- **Intelligent Voice Selection**: Gender-preferred voice selection
- **Contextual Commands**: Start, encourage, and stop cues
- **Skip-Aware Muting**: Intelligent silence during rapid exercise skipping

### 📊 Advanced Training Tracking
- **Weekly Limits**: Maximum 5 full training days per week
- **Progress Analytics**: Session duration, calories, distance tracking
- **Performance Comparison**: Last vs Today performance metrics
- **Full Day Recognition**: 60+ minute sessions marked as complete days

### 💾 Robust Data Persistence
- **IndexedDB Storage**: Profile, history, and runtime state
- **Crash Recovery**: Automatic session resume after app crashes
- **Background Resilience**: Maintains state during tab switching
- **Version Migration**: Seamless database schema upgrades

### 🌐 Offline-First Architecture
- **Adaptive Caching**: Different strategies for new vs returning users
- **Network Resilience**: Functions in poor connectivity conditions
- **Atomic Updates**: Complete cache replacement or rollback
- **Resource Optimization**: Critical asset prioritization

### ⚡ Performance Optimizations
- **Wake Lock**: Prevents screen sleep during workouts
- **Background Sync**: Maintains timer accuracy during tab switches
- **Memory Management**: Efficient state handling and cleanup
- **Resource Loading**: Lazy loading and cache-first strategies

## 🔧 Technical Architecture

### Service Worker Strategy
- **Network-First with Fallbacks**: Tries network, falls back to cache
- **Adaptive Timeouts**: 20-30s for new users, 3-5s for returning users
- **Complete Asset Verification**: Ensures all critical files are cached
- **Cache Lock Rescue**: Automatic recovery from corrupted cache states

### State Management
- **Single Source of Truth**: `workout.startedAt` timestamp for accuracy
- **Runtime Persistence**: Survives browser crashes and reloads
- **Exercise Queue System**: Randomized, resumable workout sequences
- **Debounced Voice Control**: Intelligent intro scheduling with mute awareness

### Database Schema
```javascript
// Profile Store
{ id: "user", data: { gender, weight, height } }

// History Store  
{ id: timestamp, date: timestamp, duration: seconds, fullDay: boolean }

// Runtime Store (Resilience)
{ id: "current", running: boolean, startedAt: timestamp, sport: string, langPref: string }
```

## 📚 Dependencies

### Core Runtime
- **Express**: `^4.18.2` - Web server framework
- **Node.js**: v20+ Alpine - Lightweight container runtime

### Browser APIs
- **Web Speech API**: Multi-language text-to-speech
- **IndexedDB**: Client-side database storage
- **Service Workers**: Offline functionality and caching
- **Wake Lock API**: Screen sleep prevention
- **File System Access**: Training data loading

### Build Tools
- **Docker**: Containerization and deployment
- **GitHub Actions**: Automated CI/CD pipeline

## 🐳 Docker Deployment

### Build Docker Image
```bash
docker build -t hery:latest .
```

### Run Container
```bash
# Basic run
docker run -p 3000:3000 hery:latest

# With environment variables
docker run -p 3000:3000 \
  -e CACHE_VERSION=v3 \
  -e PORT=3000 \
  hery:latest
```

### Docker Configuration
- **Base Image**: Node.js 23 Alpine
- **Multi-stage Build**: Optimized production image
- **Working Directory**: `/app`
- **Exposed Port**: 3000
- **Health Checks**: Built-in container health monitoring

### GitHub Actions Deployment
```yaml
# Manual trigger workflow
name: Manual Build and Push Docker Image
on: workflow_dispatch
jobs:
  - Build Docker image
  - Push to Docker Hub
  - Environment: ubuntu-latest
```

## 💡 Usage

### Getting Started
1. **Profile Setup**: Enter gender, weight, and height for personalized metrics
2. **Sport Selection**: Choose from Boxing, Judo, Wushu, Pushups, Abs, or Bike
3. **Language Preference**: Select coaching language or use "Random Languages"
4. **Start Training**: Press play to begin your guided workout

### Training Session
- **Voice Coaching**: Listen to exercise instructions and timing cues
- **Skip Feature**: Skip exercises with intelligent voice muting
- **Progress Tracking**: Real-time session timer and performance metrics
- **Background Safety**: App maintains state even when minimized

### Post-Workout
- **Session Logging**: Automatic save to training history
- **Performance Analysis**: Compare with previous sessions
- **Weekly Progress**: Track full training days (60+ minutes)
- **Recovery Reminders**: Smart rest day recommendations

## 🌐 Supported Languages

| Language | Code | Voice Support | Exercise Instructions |
|----------|------|---------------|----------------------|
| English | `en` | ✅ | ✅ |
| Français | `fr` | ✅ | ✅ |
| Español | `es` | ✅ | ✅ |
| 中文 | `zh` | ✅ | ✅ |
| 日本語 | `ja` | ✅ | ✅ |
| Русский | `ru` | ✅ | ✅ |

### Voice Features
- **Gender Preference**: Automatic female voice selection when available
- **Natural Speech**: Context-aware coaching phrases
- **Cultural Adaptation**: Language-specific motivational cues

## 🥋 Training Programs

### Boxing 🥊
- **Technical Combinations**: Jab-Cross, Hook-Uppercut sequences
- **Defensive Drills**: Slips, ducks, parries, counter-attacks
- **Footwork Training**: Pivots, angles, ring cutting
- **Power Development**: Heavy bag work, explosive movements
- **Conditioning**: Speed bag rhythm, double-end bag timing

### Judo 🥋
- **Uchi-komi Practice**: Entry repetitions with proper kuzushi
- **Throwing Techniques**: Osoto-gari, Ouchi-gari, Seoi-nage shadows
- **Ne-waza Transitions**: Ground work and escapes
- **Ukemi Training**: Breakfall practice for safety
- **Grip Fighting**: Kumi-kata strategies and tactics

### Wushu (Kung Fu) 🐉
- **Animal Forms**: Tiger, Snake, Crane, Dragon, Monkey, Mantis styles
- **Traditional Stances**: Ma Bu, Gong Bu, Xu Bu variations
- **Internal Energy**: Breathing exercises and meditation
- **Weapon Forms**: Staff, sword, spear simulated movements
- **Flexibility Training**: Dynamic and static stretching routines

### Fitness Programs 💪
- **Pushups**: Standard, diamond, wide-grip, explosive variations
- **Core Strength**: Planks, bicycle crunches, leg raises, Russian twists
- **Cycling**: Endurance rides, sprint intervals, standing climbs
- **Functional Movement**: Compound exercises and mobility work

## 📱 Progressive Web App

### Installation
- **Add to Home Screen**: Install directly from browser
- **Offline Access**: Full functionality without internet
- **App-like Experience**: Native mobile app feel
- **Automatic Updates**: Background service worker updates

### Mobile Optimization
- **Touch-Friendly**: Large buttons and gesture support
- **Responsive Design**: Adapts to all screen sizes
- **Battery Optimization**: Efficient wake lock management
- **Performance**: Smooth 60fps animations and transitions

### Cross-Platform Support
- **iOS Safari**: Full PWA support with install prompts
- **Android Chrome**: Native app integration
- **Desktop**: Chromium-based browsers with window management
- **Offline Sync**: Seamless experience across devices

## 📄 License

MIT License

Copyright (c) 2025 Mino

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

**Ready to train? Get started with Hery and elevate your training journey!** 🥊🥋🐉


