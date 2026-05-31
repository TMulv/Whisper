import { ExpoConfig, ConfigContext } from 'expo/config';
import { withInfoPlist } from '@expo/config-plugins';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Whisper',
  slug: 'whisper',
  scheme: 'whisper',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  newArchEnabled: false,
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'moe.gno.app',
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? './GoogleService-Info.plist',
    infoPlist: {
      UIBackgroundModes: ['audio', 'fetch'],
      NSDocumentsFolderUsageDescription:
        'Whisper needs access to your documents to open epub and audio files.',
    },
  },
  android: {
    package: 'moe.gno.app',
    googleServicesFile: './google-services.json',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    permissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    ],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    '@react-native-firebase/app',
    'expo-asset',
    'expo-secure-store',
    'expo-web-browser',
    [
      'expo-build-properties',
      {
        ios: {
          useFrameworks: 'static',
        },
      },
    ],
    [
      'expo-document-picker',
      {
        iCloudContainerEnvironment: 'Production',
      },
    ],
    (config: ExpoConfig) =>
      withInfoPlist(config, (c) => {
        c.modResults.CFBundleDocumentTypes = [
          {
            CFBundleTypeName: 'M4B Audiobook',
            CFBundleTypeRole: 'Viewer',
            LSItemContentTypes: ['com.apple.m4b-audio'],
            CFBundleTypeExtensions: ['m4b'],
            LSHandlerRank: 'Alternate',
          },
          {
            CFBundleTypeName: 'MPEG-4 Audio',
            CFBundleTypeRole: 'Viewer',
            LSItemContentTypes: ['public.mpeg-4-audio'],
            CFBundleTypeExtensions: ['m4a'],
            LSHandlerRank: 'Alternate',
          },
          {
            CFBundleTypeName: 'MP3 Audio',
            CFBundleTypeRole: 'Viewer',
            LSItemContentTypes: ['public.mp3'],
            CFBundleTypeExtensions: ['mp3'],
            LSHandlerRank: 'Alternate',
          },
          {
            CFBundleTypeName: 'EPUB Document',
            CFBundleTypeRole: 'Viewer',
            LSItemContentTypes: ['org.idpf.epub-container'],
            CFBundleTypeExtensions: ['epub'],
            LSHandlerRank: 'Alternate',
          },
        ];
        c.modResults.UTImportedTypeDeclarations = [
          {
            UTTypeIdentifier: 'com.apple.m4b-audio',
            UTTypeDescription: 'M4B Audiobook',
            UTTypeConformsTo: ['public.audio', 'public.mpeg-4-audio'],
            UTTypeTagSpecification: {
              'public.filename-extension': ['m4b'],
              'public.mime-type': ['audio/mp4', 'audio/x-m4b'],
            },
          },
        ];
        return c;
      }),
  ],
  extra: {
    dropboxAppKey: process.env.DROPBOX_APP_KEY ?? '',
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? '1ea42195-05bb-4279-a7ce-697540ac3179',
    },
  },
});