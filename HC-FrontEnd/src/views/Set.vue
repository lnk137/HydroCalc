<template>
  <div class="body">
    <div class="argument">
      <!-- HSV范围 -->
      <div class="HSV-container">
        <div class="input-group">
          <label>H值下限</label>
          <input
            v-model="settingsStore.lowerHue"
            type="number"
            min="0"
            max="255"
            class="custom-input"
          />
        </div>
        <div class="input-group">
          <label>S值下限</label>
          <input
            v-model="settingsStore.lowerSaturation"
            type="number"
            min="0"
            max="255"
            class="custom-input"
          />
        </div>
        <div class="input-group">
          <label>V值下限</label>
          <input
            v-model="settingsStore.lowerValue"
            type="number"
            min="0"
            max="255"
            class="custom-input"
          />
        </div>
        <div class="input-group">
          <label>H值上限</label>
          <input
            v-model="settingsStore.upperHue"
            type="number"
            min="0"
            max="255"
            class="custom-input"
          />
        </div>
        <div class="input-group">
          <label>S值上限</label>
          <input
            v-model="settingsStore.upperSaturation"
            type="number"
            min="0"
            max="255"
            class="custom-input"
          />
        </div>
        <div class="input-group">
          <label>V值上限</label>
          <input
            v-model="settingsStore.upperValue"
            type="number"
            min="0"
            max="255"
            class="custom-input"
          />
        </div>
      </div>
      <!-- 分辨率调整 -->
      <div class="other">
        <div class="resolution-container">
          <label>分辨率大小</label>
          <input
            v-model="settingsStore.resolutionWidth"
            type="number"
            min="1"
            max="2000"
            class="custom-input"
          />
          <label>x</label>
          <input
            v-model="settingsStore.resolutionHeight"
            type="number"
            min="1"
            max="2000"
            class="custom-input"
          />
        </div>
        <div class="soli-container">
          <label>土壤剖面宽度</label>
          <input
            v-model="settingsStore.soilWidth"
            type="number"
            min="1"
            max="1000"
            class="custom-input"
          />
        </div>
        <div class="start-height-container">
          <label>起始高度</label>
          <input
            v-model="settingsStore.startHeight"
            type="number"
            min="0"
            max="20000"
            class="custom-input"
          />
        </div>
      </div>
    </div>
    <!-- 选择模型路径 -->
    <div class="">
      <div class="model_choose">
        <img src="@/assets/文件夹.svg" alt="选择" class="icon" @click="choose_model" title="选择路径"/>
        <span v-if="settingsStore.modelPath"  class="path_font">{{settingsStore.modelPath}}</span>
        <span v-else class="path_font">选择模型路径</span>
      </div>
      <div  v-if="settingsStore.modelPath" class="tip">
        提醒!选择模型路径后，禁止使用参数调整功能
      </div>
    </div>
    <!-- 树 -->
    <div>
      <img :src="tree" alt="树木" class="image" draggable="false" />
    </div>
  </div>
</template>

<script setup>
import tree from "@/assets/树木.png";
import { useSettingsStore } from "@/stores/settingsStore"; // 导入 Pinia Store
import { ref ,watch} from "vue";
import axios from 'axios';  // 确保导入 axios
const settingsStore = useSettingsStore();

const choose_model = async () => {
  try {
    const response = await axios.post("http://localhost:5000/getModelPath");
    const data = response.data;
    settingsStore.updateModelPath(data.file_path);
    console.log(data.file_path);

  } catch (error) {
    console.error('选择路径失败', error);
  }
};
watch(
  () => [
    settingsStore.lowerHue,
    settingsStore.lowerSaturation,
    settingsStore.lowerValue,
    settingsStore.upperHue,
    settingsStore.upperSaturation,
    settingsStore.upperValue,
    settingsStore.resolutionWidth,
    settingsStore.resolutionHeight,
    settingsStore.soilWidth,
    settingsStore.startHeight
  ],
  () => {
      console.log("参数发生变化，重新处理图像");
      settingsStore.updateIsSetUpdate(true);
      settingsStore.sendColorRanges()
  },
  { deep: true }
);

</script>

<style scoped lang="less">

.body {
  font-size: 20px;
  color: #303440;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  flex-wrap: wrap;
  .argument{
    display: flex;
    align-items: flex-start;
    justify-content: center;
    flex-wrap: wrap;
    margin: 40px 0;
  }
}

.HSV-container {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
}

.input-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 20px;
  flex-basis: calc(33.333% - 30px);
}

label {
  margin-bottom: 8px;
  font-size: 14px;
  color: #606f7b;
  font-weight: 600;
  display: flex;
  justify-content: center;
}

.custom-input {
  width: 50px;
  padding: 8px;
  font-size: 16px;
  border: none;
  border-radius: 8px;
  background-color: #d8ede9;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: box-shadow 0.3s ease, background-color 0.3s ease;
  &:hover {
    opacity: 1;
    background-color: rgba(255, 255, 255, 0.664);
  }
  &:focus {
    outline: none;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
    background-color: #eef5f4;
  }
}

.resolution-container {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 20px;
  label {
    margin: 0 10px;
  }
}

.soli-container {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 20px;
  label {
    margin: 0 10px;
  }
}

.start-height-container {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 20px;
  label {
    margin: 0 10px;
  }
}
.other {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.image {
  max-width: 700px;
  position: absolute;
  bottom: 0;
  left: 250px;
  right: 0;
  opacity: 0.9;
}
.button-container{
  position: absolute;
  top: 300px;
  left: 53%;
}
.model_choose{
  position: absolute;
  display: flex;
  flex-wrap: nowrap;
  top:350px;
  left:50%;
  color: #626F7B;
}
.icon{
  width: 30px;
  height: 30px;
  cursor: pointer;
  transition: transform 0.3s;
  &:hover{
    transform: scale(1.1);
  }
}
.path_font {
  white-space: nowrap; /* 禁止换行 */
  overflow: hidden; /* 溢出部分隐藏 */
  text-overflow: ellipsis; /* 超出部分显示省略号 */
  max-width: 280px; /* 设置最大宽度，超出后使用省略号 */
  display: inline-block; /* 保证其为块元素，支持宽度设定 */
  font-weight: bold;
}
.tip{
  position: absolute;
  font-size: 14px;
  top:400px;
  left:50%;
  color: #626F7B;
}
</style>
