import { registerRootComponent } from 'expo';

import App from './App';
import { registerBackgroundPushHandler } from './src/services/firebase/messaging';

// Precisa existir antes do app montar: push com o app fechado chega por aqui.
registerBackgroundPushHandler();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
