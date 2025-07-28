#!/bin/bash

# Exit on error
set -e

# Configuration
RGB_NODE_REPO="https://github.com/RGB-Tools/rgb-lightning-node"
BUILD_DIR="$(pwd)/build"
# ANDROID_ARCHS="aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android"
IOS_ARCHS="aarch64-apple-ios x86_64-apple-ios"

# Create build directory
mkdir -p "$BUILD_DIR"

# Clone RGB Lightning Node repository with submodules
if [ ! -d "$BUILD_DIR/rgb-lightning-node" ]; then
    git clone "$RGB_NODE_REPO" --recurse-submodules --shallow-submodules "$BUILD_DIR/rgb-lightning-node"
fi

cd "$BUILD_DIR/rgb-lightning-node"
git fetch --all --tags
git checkout master

# Install Rust if not installed
if ! command -v rustup &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source $HOME/.cargo/env
fi

# Install cross-compilation tools
rustup target add $ANDROID_ARCHS $IOS_ARCHS

# Build for Android
# echo "Building RGB Lightning Node for Android..."
# for arch in $ANDROID_ARCHS; do
#     echo "Building for $arch..."
#     cargo build --release --target $arch --locked
    
#     # Copy to appropriate directory
#     mkdir -p "../android/$arch"
#     cp "target/$arch/release/rgb-lightning-node" "../android/$arch/"
# done

# Build for iOS
echo "Building RGB Lightning Node for iOS..."
for arch in $IOS_ARCHS; do
    echo "Building for $arch..."
    cargo build --release --target $arch --locked
    
    # Copy to appropriate directory
    mkdir -p "../ios/$arch"
    cp "target/$arch/release/rgb-lightning-node" "../ios/$arch/"
done

# Create universal binary for iOS
echo "Creating universal binary for iOS..."
mkdir -p "../ios/universal"
lipo -create "../ios/aarch64-apple-ios/rgb-lightning-node" "../ios/x86_64-apple-ios/rgb-lightning-node" -output "../ios/universal/rgb-lightning-node"

# Copy binaries to app directories
echo "Copying binaries to app directories..."

# Android
# mkdir -p "../../android/app/src/main/jniLibs"
# cp -r "../android/aarch64-linux-android/rgb-lightning-node" "../../android/app/src/main/jniLibs/arm64-v8a/"
# cp -r "../android/armv7-linux-androideabi/rgb-lightning-node" "../../android/app/src/main/jniLibs/armeabi-v7a/"
# cp -r "../android/x86_64-linux-android/rgb-lightning-node" "../../android/app/src/main/jniLibs/x86_64/"
# cp -r "../android/i686-linux-android/rgb-lightning-node" "../../android/app/src/main/jniLibs/x86/"

# iOS
mkdir -p "../../ios/Rate"
cp "../ios/universal/rgb-lightning-node" "../../ios/Rate/"

echo "RGB Lightning Node build and bundling complete!" 