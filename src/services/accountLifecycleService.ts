import { auth } from '../config/firebase';
import { getApiUrl } from '../utils/apiConfig';

/** Permanently deletes the authenticated owner's restaurant and restores customer access. */
export async function permanentlyDeleteOwnedRestaurant(
  restaurantId: string,
  restaurantName: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to delete the restaurant.');

  const cleanRestaurantId = restaurantId.trim();
  const cleanRestaurantName = restaurantName.trim();
  if (!cleanRestaurantId || !cleanRestaurantName) {
    throw new Error('Restaurant identity is required.');
  }

  const idToken = await user.getIdToken(true);
  const response = await fetch(getApiUrl('/api/account/delete-restaurant'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({
      restaurantId: cleanRestaurantId,
      confirmationName: cleanRestaurantName
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.message || 'Restaurant deletion failed. No account changes were applied.');
  }
}
