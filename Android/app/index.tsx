import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/stores/authStore';

export default function Index() {
  const { token } = useAuthStore();
  return <Redirect href={token ? '/(tabs)/map' : '/(auth)/intro'} />;
}
