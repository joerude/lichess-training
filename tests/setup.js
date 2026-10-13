// Every test file starts with the profile the suite was written for; tests/profile.test.js covers other profiles.
import { setActiveProfile } from '../extension/core/profile.js';

setActiveProfile({ username: 'sebajun777', timeZone: 'Asia/Bishkek' });
