现在rust-dsp-crates/cloudseed/cloudseed-rs这个目录下有一个混响DSP。
你现在需要按照上述你说的这个流程，实现这样的AUv2插件。
你需要一个设计良好的UI；
暴露cloudseed的所有参数，并且以合理的UI元素和形式展现出来。
然后实现整个插件，测通。

---

参考ui-references/cloudseed.html
现在我想让UI长这个样子，这是原插件作者推荐的UI，也是插件作者在他自己实现的UI里面的样式。
但是我发现部分参数是不匹配的，可能是经过一些二次映射的，名称不完全匹配。而作者的插件是闭源软件，只有DSP是开源的。
先尝试吧这上面的所有控件都映射到cloudseed的参数上。

我观看插件演示视频看见，这些数值按钮，**以及种子按钮**，都是按住上下拖动增减的。
以及，数值按钮总是深色。
重新整理

---

现在我已经把这个项目从原本的C++框架改成Rust&C++框架了.
更改后的流程参考rust-auv2-docs/logic-pro-au-cache.md这个文档
更改前的流程参考README.md
你认为在更改之后，有哪一些文档是可以清除掉的？
- 我希望这个目录下的项目模板给LLM agents留下一个良好的工作空间，保留我的新项目架构所需要的文档和文件架构，不要保留老的架构遗留下来的文档和过时的文件；
- 但是在老的仓库里面，有一些文档和流程里面有对于新的架构有用的流程和知识，我希望保留下来
回答上述问题。先不要写代码
---

阅读README，你应该可以看到我现在已经把整个项目的技术栈从C++ 换成了Rust加C++。然后你可以看到Git log里面有若干条Commit message是以trim修剪开头的提交，删除了一些没有用的框架代码和文档。
但是我怀疑那些框架代码和文档里面有一些可以复用的经验，你可以帮我找一下吗？先不要写代码或者文件，先讨论一下

---

阅读 [CloudSeed](plugins/CloudSeed/) 的代码，这是我们插件架构的参考；然后阅读UI设计稿 [debess.html](design-gallery/debess/debess.html) ；然后完成任务：
- 将DeBess DSP [DeBess](airwindows/plugins/MacAU/DeBess/) word-for-word 移植到Rust；
- 在 [plugins](plugins/) 目录下实现DeBes AUv2插件，使用和CloudSeed一样的架构。
注意音频插件的一切设计要求；注意correctly animate UI.
[agent-workflow.md](rust-auv2-docs/agent-workflow.md) 遵守代码要求，不允许在C++代码写任何逻辑，包括任何atomic等逻辑，C++仅是一层纯粹的胶水，一切逻辑都在Rust代码里面实现。如果需要的话，rust的代码是可以分mod的。

我希望你先认真思考一下，频谱图等那两个图要怎么画，我们需要以复用的标准来实现这两个UI界面，因为我希望后续就不要重新实现了。
