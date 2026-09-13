import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { NativeAd } from 'react-native-google-mobile-ads';
import { NativeAdCard } from '../components/NativeAdCard';
import { setAdConfigSource } from '../config/adConfig';
import { useAdStore } from '../core/AdState';

jest.mock('@/services/firebase/analytics', () => ({ logEvent: jest.fn(), logScreen: jest.fn() }));
jest.mock('@/services/firebase/remoteConfig', () => ({ flag: jest.fn(), initRemoteConfig: jest.fn() }));

const createForAdRequest = NativeAd.createForAdRequest as jest.Mock;

/** O `NativeAd` real tem construtor privado; no mock ele é público, daí o cast. */
const fakeNativeAd = () => new (NativeAd as unknown as new () => NativeAd)();

/**
 * Duas regras de layout que não podem quebrar:
 *  - anúncio carregado aparece **sempre** identificado como patrocinado;
 *  - anúncio que não carrega não deixa buraco na tela.
 */
describe('NativeAdCard', () => {
  beforeEach(() => {
    setAdConfigSource(null);
    createForAdRequest.mockReset();
    useAdStore.setState({ adsEnabled: true, canRequestAds: true });
  });

  it('mostra o anúncio identificado quando ele carrega', async () => {
    createForAdRequest.mockResolvedValue(fakeNativeAd());
    const view = await render(<NativeAdCard placement="home_native_primary" />);

    await waitFor(() => expect(view.getByTestId('native-ad-home_native_primary')).toBeTruthy());
    expect(view.getByText('Patrocinado')).toBeTruthy();
    expect(view.getByText('Título do anúncio')).toBeTruthy();
  });

  it('não renderiza nada quando o anúncio falha', async () => {
    createForAdRequest.mockRejectedValue(new Error('no fill'));
    const view = await render(<NativeAdCard placement="home_native_primary" />);

    await waitFor(() => expect(createForAdRequest).toHaveBeenCalled());
    expect(view.queryByTestId('native-ad-home_native_primary')).toBeNull();
  });

  it('não requisita anúncio sem consentimento', async () => {
    useAdStore.setState({ canRequestAds: false });
    createForAdRequest.mockResolvedValue(fakeNativeAd());
    const view = await render(<NativeAdCard placement="home_native_primary" />);

    await waitFor(() => expect(createForAdRequest).not.toHaveBeenCalled());
    expect(view.queryByTestId('native-ad-home_native_primary')).toBeNull();
  });

  it('não requisita anúncio com o kill switch desligado', async () => {
    setAdConfigSource(() => ({ adsEnabled: false }));
    createForAdRequest.mockResolvedValue(fakeNativeAd());
    const view = await render(<NativeAdCard placement="home_native_primary" />);

    await waitFor(() => expect(createForAdRequest).not.toHaveBeenCalled());
    expect(view.queryByTestId('native-ad-home_native_primary')).toBeNull();
  });

  it('não requisita anúncio num placement desligado (perfil)', async () => {
    createForAdRequest.mockResolvedValue(fakeNativeAd());
    const view = await render(<NativeAdCard placement="profile_native" />);

    await waitFor(() => expect(createForAdRequest).not.toHaveBeenCalled());
    expect(view.queryByTestId('native-ad-profile_native')).toBeNull();
  });

  it('destrói o anúncio ao sair da tela (sem vazar listeners)', async () => {
    const ad = fakeNativeAd();
    createForAdRequest.mockResolvedValue(ad);
    const view = await render(<NativeAdCard placement="home_native_primary" />);

    await waitFor(() => expect(view.getByTestId('native-ad-home_native_primary')).toBeTruthy());
    await view.unmount();
    expect(ad.destroy).toHaveBeenCalled();
  });
});
