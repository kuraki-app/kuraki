import { Redirect } from 'expo-router';

// Route groups share the public / URL. Give a cold launch one explicit match
// instead of relying on the alphabetical order of the tabs' index screens.
export default function Start() {
  return <Redirect href="/(app)/(gallery)" />;
}
