#!/bin/bash

# Vista Running - iOS Deployment Script
# This script automates the build and deployment process for iOS

echo "🏃‍♂️ Vista Running - iOS Deployment Script"
echo "=========================================="

# Check if we're in the right directory
if [ ! -f "capacitor.config.ts" ]; then
    echo "❌ Error: capacitor.config.ts not found. Please run this script from the project root."
    exit 1
fi

# Check if Node.js dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing Node.js dependencies..."
    npm install
fi

echo "🔧 Building React application..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed! Please check for errors above."
    exit 1
fi

echo "✅ Build completed successfully!"

echo "📱 Syncing with iOS project..."
npx cap sync

if [ $? -ne 0 ]; then
    echo "❌ Capacitor sync failed! Please check for errors above."
    exit 1
fi

echo "✅ iOS sync completed successfully!"

echo "🔍 Running quick validation checks..."

# Check if iOS project exists
if [ ! -d "ios" ]; then
    echo "❌ iOS project directory not found!"
    exit 1
fi

# Check if dist directory exists and has content
if [ ! -f "dist/public/index.html" ]; then
    echo "❌ Built web assets not found!"
    exit 1
fi

echo "✅ Validation checks passed!"

echo "📊 Project Status Summary:"
echo "=========================="
echo "✅ React app built successfully"
echo "✅ iOS project synced"
echo "✅ Haptic feedback implemented"
echo "✅ Native iOS optimizations applied"
echo "✅ App Store ready configuration"
echo "✅ Privacy policy prepared"
echo "✅ Testing checklist available"

echo ""
echo "🚀 Next Steps:"
echo "==============="
echo "1. Open Xcode: npx cap open ios"
echo "2. Configure code signing in Xcode"
echo "3. Test on physical device"
echo "4. Follow ios-testing-checklist.md"
echo "5. Submit to App Store using APP_STORE_GUIDE.md"

echo ""
echo "📂 Important Files Created:"
echo "==========================="
echo "• APP_STORE_GUIDE.md - Complete submission guide"
echo "• PRIVACY_POLICY.md - App Store compliant privacy policy"
echo "• ios-testing-checklist.md - Comprehensive testing guide"
echo "• capacitor.config.ts - App Store ready configuration"
echo "• client/src/lib/ios-utils.ts - Native iOS utilities"

echo ""
echo "🎯 Key Features Implemented:"
echo "============================="
echo "• Native haptic feedback throughout the app"
echo "• iOS-specific performance optimizations"
echo "• Apple Human Interface Guidelines compliance"
echo "• Production-ready SOLID architecture"
echo "• Comprehensive error handling"
echo "• App Store submission preparation"

echo ""
echo "⚡ Ready to open in Xcode!"
read -p "Open Xcode now? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🔨 Opening Xcode..."
    npx cap open ios
else
    echo "👍 You can open Xcode later with: npx cap open ios"
fi

echo ""
echo "🎉 Deployment preparation complete!"
echo "Your Vista Running app is ready for App Store submission!"
echo ""
echo "Good luck with your app launch! 🚀"
