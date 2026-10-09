Pod::Spec.new do |s|
  s.name           = 'KaleidoRgb'
  s.version        = '0.1.0'
  s.summary        = 'RGB-Tools rgb-lib for the KaleidoSwap app'
  s.description    = 'Expo module over the official rgb-lib Swift bindings (rgb-lib-swift).'
  s.license        = 'MIT'
  s.author         = 'KaleidoSwap'
  s.homepage       = 'https://github.com/kaleidoswap/Rate'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/kaleidoswap/Rate.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # RgbLib.swift is the generated binding from rgb-lib-swift at the pinned tag;
  # rgb_libFFI.xcframework is that release's binary, fetched and checksum-verified
  # by ../scripts/download-rgb-lib-ios.js (run on install).
  s.source_files = '*.swift'
  s.vendored_frameworks = 'rgb_libFFI.xcframework'
  s.preserve_paths = 'rgb_libFFI.xcframework'
end
