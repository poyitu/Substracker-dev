// ============================================================
// 可滑动行组件 — 左滑露出删除按钮
// ============================================================

import React, { useRef } from 'react';
import { View, StyleSheet, Animated, PanResponder, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  children: React.ReactNode;
  onDelete: () => void;
  onPress: () => void;
}

export default function SwipeableRow({ children, onDelete, onPress }: Props) {
  const translateX = useRef(new Animated.Value(0)).current;
  const deleteWidth = 80;
  const threshold = deleteWidth / 2;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // 只有水平滑动超过 8px 且大于垂直滑动才响应
        return Math.abs(gestureState.dx) > 8 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          // 只允许左滑
          translateX.setValue(Math.max(gestureState.dx, -deleteWidth));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -threshold) {
          // 滑过阈值，展开
          Animated.spring(translateX, {
            toValue: -deleteWidth,
            useNativeDriver: true,
            bounciness: 10,
          }).start();
        } else {
          // 弹回
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 10,
          }).start();
        }
      },
    }),
  ).current;

  const close = () => {
    Animated.timing(translateX, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={styles.wrapper}>
      {/* 背景删除按钮 */}
      <View style={styles.deleteBg}>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => {
            close();
            onDelete();
          }}
        >
          <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* 前景内容 */}
      <Animated.View
        style={[styles.foreground, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.touchable}>
          {children}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 8,
    borderRadius: 10,
    overflow: 'hidden',
  },
  deleteBg: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 80,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtn: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  foreground: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
  },
  touchable: {
    borderRadius: 10,
  },
});
