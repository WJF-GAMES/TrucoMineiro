import React from 'react';
import { StyleSheet } from 'react-native';
import { colors, spacing } from '@/design-system';
import { AppText, GameHeader, Screen, Surface } from '@/components';
import type { RootScreenProps, StaticPageKind } from '@/navigation/types';

const PAGES: Record<
  StaticPageKind,
  { title: string; sections: { heading: string; body: string }[] }
> = {
  terms: {
    title: 'Termos de Uso',
    sections: [
      {
        heading: '1. Aceitação',
        body: 'Ao usar o Truco Mineiro você concorda com estes termos. O app é um jogo de entretenimento sem apostas em dinheiro real.',
      },
      {
        heading: '2. Conta',
        body: 'Sua conta é vinculada ao seu número de telefone. Você é responsável por manter o acesso ao seu chip e por toda atividade na conta.',
      },
      {
        heading: '3. Conduta',
        body: 'Respeito, amizade e boa resenha. Apelidos ofensivos, trapaças ou uso de programas automatizados resultam em suspensão.',
      },
      {
        heading: '4. Anúncios',
        body: 'O app é gratuito e mantido por anúncios. Nenhum anúncio dá vantagem no jogo, e nada é cobrado do jogador.',
      },
      {
        heading: '5. Alterações',
        body: 'Podemos atualizar estes termos e avisaremos no app quando isso acontecer.',
      },
    ],
  },
  privacy: {
    title: 'Política de Privacidade',
    sections: [
      {
        heading: 'O que coletamos',
        body: 'Número de telefone (apenas para autenticação via Firebase), apelido, avatar, estatísticas de jogo e dados técnicos de uso e falhas.',
      },
      {
        heading: 'Como usamos',
        body: 'Para autenticar você, manter seu progresso, montar partidas online, exibir rankings e melhorar o app.',
      },
      {
        heading: 'Compartilhamento',
        body: 'Não vendemos dados. Utilizamos serviços do Google Firebase (Authentication, Firestore, Realtime Database, Analytics, Crashlytics).',
      },
      {
        heading: 'Seus direitos',
        body: 'Você pode excluir sua conta a qualquer momento em Configurações > Excluir Conta. Isso apaga seu perfil e progresso.',
      },
    ],
  },
  privacy_security: {
    title: 'Privacidade e Segurança',
    sections: [
      {
        heading: 'Login por telefone',
        body: 'Entramos com um código enviado por SMS. Nunca pedimos senha e o código nunca é armazenado no app.',
      },
      {
        heading: 'Proteção contra trapaças',
        body: 'As partidas online são validadas no servidor. Sua pontuação, liga e recompensas só podem ser alteradas pelo servidor.',
      },
      {
        heading: 'Visibilidade',
        body: 'Seu apelido, avatar, nível e liga são públicos para outros jogadores. Seu telefone nunca é exibido.',
      },
    ],
  },
  help: {
    title: 'Ajuda e Suporte',
    sections: [
      {
        heading: 'Não recebi o SMS',
        body: 'Confira o número, aguarde até 1 minuto e toque em Reenviar. Verifique se seu chip tem sinal.',
      },
      {
        heading: 'Caí da partida',
        body: 'Ao voltar para o app, tentamos reconectar você automaticamente à mesma mesa por até 60 segundos.',
      },
      {
        heading: 'Fale com a gente',
        body: 'Escreva para suporte@trucomineiro.app com seu apelido e uma descrição do problema.',
      },
    ],
  },
  about: {
    title: 'Sobre o Truco Mineiro',
    sections: [
      {
        heading: 'Tradição em cada jogada',
        body: 'O Truco Mineiro é um jogo de cartas feito com carinho para quem gosta de uma boa resenha. Manilhas fixas: Zap, Sete de Copas, Espadilha e Sete de Ouros.',
      },
      {
        heading: 'Regras',
        body: 'Partidas até 12 pontos, 4 jogadores em duplas. Truco vale 3, depois Seis, Nove e Doze. Mão de onze: quem está com 11 decide se joga a mão valendo 3.',
      },
      { heading: 'Créditos', body: 'Feito por Mooby. Versão 1.0.0.' },
    ],
  },
  tips: {
    title: 'Dicas de Truco',
    sections: [
      {
        heading: 'Conheça as manilhas',
        body: 'Zap (4 de paus) > Sete de Copas > Espadilha (Ás de espadas) > Sete de Ouros. Depois vêm 3, 2, Ás, Rei, Valete, Dama, 7, 6, 5 e 4.',
      },
      {
        heading: 'Primeira mão vale ouro',
        body: 'Quem ganha a primeira rodada só precisa empatar uma das próximas. Se a primeira empata, a segunda decide.',
      },
      {
        heading: 'Truco na hora certa',
        body: 'Pedir truco com a mão forte é fácil. O bom trucador pede quando o adversário parece inseguro, mesmo sem a melhor carta.',
      },
      {
        heading: 'Confie na dupla',
        body: 'Se seu parceiro já está ganhando a rodada, não gaste sua carta boa. Guarde para a próxima.',
      },
      {
        heading: 'Correr também é jogar',
        body: 'Entregar 1 ponto é melhor que perder 3. Não aceite todo truco por orgulho.',
      },
    ],
  },
};

export function StaticPageScreen({ route }: RootScreenProps<'StaticPage'>) {
  const page = PAGES[route.params.kind];
  return (
    <Screen scroll testID={`screen-static-${route.params.kind}`}>
      <GameHeader variant="title" title={page.title} showBack />
      {page.sections.map((s) => (
        <Surface key={s.heading} style={styles.card}>
          <AppText variant="h3">{s.heading}</AppText>
          <AppText variant="body" color={colors.textSecondary} style={styles.body}>
            {s.body}
          </AppText>
        </Surface>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({ card: { marginBottom: spacing.sm }, body: { marginTop: 6 } });
